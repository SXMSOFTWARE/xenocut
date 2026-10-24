// Minimal JSON reader/writer for the effect host's line protocol (one object per line).
#pragma once
#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace xc {

struct Json {
  enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<Json> a;
  std::map<std::string, Json> o;

  const Json &operator[](const std::string &k) const {
    static const Json none;
    auto it = o.find(k);
    return it == o.end() ? none : it->second;
  }
  double num(double d = 0) const { return type == Num ? n : type == Bool ? (b ? 1 : 0) : d; }
  std::string str(const std::string &d = "") const { return type == Str ? s : d; }

  static Json parse(const std::string &text) {
    size_t i = 0;
    Json j;
    if (!value(text, i, j)) j = Json();
    return j;
  }

 private:
  static void ws(const std::string &t, size_t &i) {
    while (i < t.size() && (t[i] == ' ' || t[i] == '\t' || t[i] == '\n' || t[i] == '\r')) ++i;
  }
  static bool string(const std::string &t, size_t &i, std::string &out) {
    if (t[i] != '"') return false;
    ++i;
    while (i < t.size() && t[i] != '"') {
      char c = t[i++];
      if (c != '\\') { out += c; continue; }
      if (i >= t.size()) return false;
      char e = t[i++];
      switch (e) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'u': {
          if (i + 4 > t.size()) return false;
          unsigned cp = std::strtoul(t.substr(i, 4).c_str(), nullptr, 16);
          i += 4;
          if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= t.size() && t[i] == '\\' && t[i + 1] == 'u') {
            unsigned lo = std::strtoul(t.substr(i + 2, 4).c_str(), nullptr, 16);
            i += 6;
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          if (cp < 0x80) out += char(cp);
          else if (cp < 0x800) { out += char(0xC0 | (cp >> 6)); out += char(0x80 | (cp & 0x3F)); }
          else if (cp < 0x10000) { out += char(0xE0 | (cp >> 12)); out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F)); }
          else { out += char(0xF0 | (cp >> 18)); out += char(0x80 | ((cp >> 12) & 0x3F)); out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F)); }
          break;
        }
        default: out += e;
      }
    }
    if (i >= t.size()) return false;
    ++i;
    return true;
  }
  static bool value(const std::string &t, size_t &i, Json &j) {
    ws(t, i);
    if (i >= t.size()) return false;
    char c = t[i];
    if (c == '{') {
      j.type = Obj;
      ++i;
      ws(t, i);
      if (i < t.size() && t[i] == '}') { ++i; return true; }
      while (i < t.size()) {
        ws(t, i);
        std::string k;
        if (!string(t, i, k)) return false;
        ws(t, i);
        if (i >= t.size() || t[i] != ':') return false;
        ++i;
        Json v;
        if (!value(t, i, v)) return false;
        j.o[k] = std::move(v);
        ws(t, i);
        if (i < t.size() && t[i] == ',') { ++i; continue; }
        if (i < t.size() && t[i] == '}') { ++i; return true; }
        return false;
      }
      return false;
    }
    if (c == '[') {
      j.type = Arr;
      ++i;
      ws(t, i);
      if (i < t.size() && t[i] == ']') { ++i; return true; }
      while (i < t.size()) {
        Json v;
        if (!value(t, i, v)) return false;
        j.a.push_back(std::move(v));
        ws(t, i);
        if (i < t.size() && t[i] == ',') { ++i; continue; }
        if (i < t.size() && t[i] == ']') { ++i; return true; }
        return false;
      }
      return false;
    }
    if (c == '"') { j.type = Str; return string(t, i, j.s); }
    if (t.compare(i, 4, "true") == 0) { j.type = Bool; j.b = true; i += 4; return true; }
    if (t.compare(i, 5, "false") == 0) { j.type = Bool; j.b = false; i += 5; return true; }
    if (t.compare(i, 4, "null") == 0) { j.type = Null; i += 4; return true; }
    char *end = nullptr;
    j.n = std::strtod(t.c_str() + i, &end);
    if (end == t.c_str() + i) return false;
    j.type = Num;
    i = end - t.c_str();
    return true;
  }
};

// Length of a valid UTF-8 sequence starting at s[i], or 0.
inline size_t utf8Len(const std::string &s, size_t i) {
  unsigned char c = s[i];
  size_t n = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 0;
  if (n == 0 || i + n > s.size()) return 0;
  for (size_t k = 1; k < n; ++k)
    if ((static_cast<unsigned char>(s[i + k]) & 0xC0) != 0x80) return 0;
  return n;
}

// JSON string literal. Plug-in metadata is often Latin-1, so bytes that aren't valid UTF-8
// are re-encoded as Latin-1 code points instead of producing an invalid reply.
inline std::string quote(const std::string &s) {
  std::string o = "\"";
  for (size_t i = 0; i < s.size();) {
    unsigned char c = s[i];
    size_t n = utf8Len(s, i);
    if (n > 1) { o.append(s, i, n); i += n; continue; }
    ++i;
    if (n == 0) { o += char(0xC0 | (c >> 6)); o += char(0x80 | (c & 0x3F)); continue; }
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
        else o += char(c);
    }
  }
  return o + "\"";
}

inline std::string num(double v) {
  if (v != v) return "0";
  if (v > 1e300) return "1e300";
  if (v < -1e300) return "-1e300";
  char b[32];
  snprintf(b, sizeof b, "%.10g", v);
  return b;
}

}  // namespace xc
