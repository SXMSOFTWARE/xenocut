// frei0r filter host. The plug-in ABI (https://frei0r.dyne.org/) is small and stable, so the
// handful of entry points and structs we need are declared here.
#include "frei0r_host.h"

#include <dlfcn.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <map>
#include <memory>

namespace xc {
namespace {

struct F0rInfo {
  const char *name;
  const char *author;
  int plugin_type;
  int color_model;
  int frei0r_version;
  int major_version;
  int minor_version;
  int num_params;
  const char *explanation;
};
struct F0rParamInfo {
  const char *name;
  int type;
  const char *explanation;
};
struct F0rColor { float r, g, b; };
struct F0rPosition { double x, y; };

enum { kBool = 0, kDouble = 1, kColor = 2, kPosition = 3, kString = 4 };
enum { kFilter = 0 };
enum { kBGRA = 0, kRGBA = 1, kPacked = 2 };

std::string s(const char *c) { return c ? c : ""; }

struct Lib {
  std::string path, id;
  void *h = nullptr;
  int (*init)() = nullptr;
  void (*getInfo)(F0rInfo *) = nullptr;
  void (*getParamInfo)(F0rParamInfo *, int) = nullptr;
  void *(*construct)(unsigned, unsigned) = nullptr;
  void (*destruct)(void *) = nullptr;
  void (*setParam)(void *, void *, int) = nullptr;
  void (*getParam)(void *, void *, int) = nullptr;
  void (*update)(void *, double, const uint32_t *, uint32_t *) = nullptr;
  F0rInfo info{};
  std::string name, author, explanation;
  struct Param {
    std::string name, hint;
    int type;
  };
  std::vector<Param> params;  // copied: plug-ins don't promise their strings stay put
};

struct Inst {
  Lib *lib = nullptr;
  void *p = nullptr;
  int w = 0, h = 0;
  std::map<int, std::string> last;
  ~Inst() {
    if (p && lib) lib->destruct(p);
  }
};

std::map<std::string, std::unique_ptr<Lib>> &libs() {
  static std::map<std::string, std::unique_ptr<Lib>> m;
  return m;
}
std::map<std::string, std::unique_ptr<Inst>> &insts() {
  static std::map<std::string, std::unique_ptr<Inst>> m;
  return m;
}

template <class T>
bool sym(void *h, const char *n, T &out) {
  out = reinterpret_cast<T>(dlsym(h, n));
  return out != nullptr;
}

std::string baseId(const std::string &path) {
  std::string b = path.substr(path.find_last_of('/') + 1);
  size_t dot = b.rfind(".so");
  if (dot != std::string::npos) b = b.substr(0, dot);
  return b;
}

Lib *load(const std::string &path) {
  std::cerr << "[fxhost] loading " << path << std::endl;  // the supervisor blames the last one on a crash
  std::unique_ptr<Lib> L(new Lib);
  L->path = path;
  L->id = baseId(path);
  L->h = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!L->h) return nullptr;
  if (!sym(L->h, "f0r_init", L->init) || !sym(L->h, "f0r_get_plugin_info", L->getInfo) ||
      !sym(L->h, "f0r_get_param_info", L->getParamInfo) || !sym(L->h, "f0r_construct", L->construct) ||
      !sym(L->h, "f0r_destruct", L->destruct) || !sym(L->h, "f0r_set_param_value", L->setParam) ||
      !sym(L->h, "f0r_get_param_value", L->getParam) || !sym(L->h, "f0r_update", L->update)) {
    dlclose(L->h);
    return nullptr;
  }
  L->init();
  L->getInfo(&L->info);
  L->name = s(L->info.name);
  L->author = s(L->info.author);
  L->explanation = s(L->info.explanation);
  if (L->info.plugin_type != kFilter || L->info.num_params < 0 || L->info.num_params > 256) {
    // Sources and mixers aren't hosted yet; keep the handle loaded (plug-ins may not like
    // being unloaded after init) but don't list them.
    L->info.plugin_type = -1;
  }
  for (int i = 0; L->info.plugin_type == kFilter && i < L->info.num_params; ++i) {
    F0rParamInfo pi{};
    L->getParamInfo(&pi, i);
    L->params.push_back({s(pi.name), s(pi.explanation), pi.type});
  }
  Lib *raw = L.get();
  libs()[L->id] = std::move(L);
  return raw;
}

Lib *find(const std::string &id) {
  auto it = libs().find(id);
  return it == libs().end() || it->second->info.plugin_type != kFilter ? nullptr : it->second.get();
}

}  // namespace

void f0rScan(const std::vector<std::string> &files, std::string &json) {
  json = "{\"ok\":true,\"plugins\":[";
  bool first = true;
  for (const std::string &f : files) {
    Lib *L = libs().count(baseId(f)) ? libs()[baseId(f)].get() : load(f);
    if (!L || L->info.plugin_type != kFilter) continue;
    if (!first) json += ",";
    first = false;
    json += "{\"id\":" + quote(L->id) + ",\"label\":" + quote(L->name) + ",\"author\":" + quote(L->author) +
            ",\"description\":" + quote(L->explanation) + ",\"version\":[" + num(L->info.major_version) + "," +
            num(L->info.minor_version) + "],\"file\":" + quote(L->path) + "}";
  }
  json += "]}";
}

bool f0rDescribe(const std::string &id, std::string &json, std::string &err) {
  Lib *L = find(id);
  if (!L) { err = "unknown frei0r plug-in " + id; return false; }
  void *p = L->construct(64, 64);
  if (!p) { err = "construct failed"; return false; }
  json = "{\"ok\":true,\"params\":[";
  for (size_t i = 0; i < L->params.size(); ++i) {
    const Lib::Param &pi = L->params[i];
    static const char *types[] = {"bool", "double", "color", "position", "string"};
    if (i) json += ",";
    json += "{\"name\":" + quote(pi.name) + ",\"type\":" + quote(pi.type >= 0 && pi.type <= 4 ? types[pi.type] : "unknown") +
            ",\"hint\":" + quote(pi.hint) + ",\"default\":";
    switch (pi.type) {
      case kBool:
      case kDouble: {
        double v = 0;
        L->getParam(p, &v, int(i));
        json += "[" + num(v) + "]";
        break;
      }
      case kColor: {
        F0rColor c{0, 0, 0};
        L->getParam(p, &c, int(i));
        json += "[" + num(c.r) + "," + num(c.g) + "," + num(c.b) + "]";
        break;
      }
      case kPosition: {
        F0rPosition q{0, 0};
        L->getParam(p, &q, int(i));
        json += "[" + num(q.x) + "," + num(q.y) + "]";
        break;
      }
      case kString: {
        char *v = nullptr;
        L->getParam(p, &v, int(i));
        json += quote(s(v));
        break;
      }
      default:
        json += "null";
    }
    json += "}";
  }
  json += "]}";
  L->destruct(p);
  return true;
}

void f0rDrop(const std::string &key) { insts().erase(key); }

void f0rShutdown() { insts().clear(); }

bool f0rRender(const std::string &id, const std::string &key, const Json &params, const Frame &f, std::string &err) {
  Lib *L = find(id);
  if (!L) { err = "unknown frei0r plug-in " + id; return false; }
  // frei0r wants dimensions that are multiples of 8: pad by repeating edge pixels.
  int pw = (f.w + 7) / 8 * 8, ph = (f.h + 7) / 8 * 8;
  std::unique_ptr<Inst> &I = insts()[key];
  if (!I || I->lib != L || I->w != pw || I->h != ph) {
    I.reset(new Inst);
    I->lib = L;
    I->w = pw;
    I->h = ph;
    I->p = L->construct(unsigned(pw), unsigned(ph));
    if (!I->p) { insts().erase(key); err = "construct failed"; return false; }
    if (insts().size() > 24) {
      for (auto it = insts().begin(); it != insts().end(); ++it)
        if (it->first != key) { insts().erase(it); break; }
    }
  }
  for (size_t i = 0; i < L->params.size(); ++i) {
    const Json &v = params[L->params[i].name];
    if (v.type == Json::Null) continue;
    std::string sig = v.type == Json::Str ? "s" + v.s : "";
    if (v.type == Json::Arr) for (const Json &x : v.a) sig += num(x.num()) + ",";
    else if (v.type != Json::Str) sig = num(v.num());
    if (I->last[int(i)] == sig) continue;
    I->last[int(i)] = sig;
    auto at = [&](size_t k) { return v.type == Json::Arr ? (k < v.a.size() ? v.a[k].num() : 0.0) : v.num(); };
    switch (L->params[i].type) {
      case kBool:
      case kDouble: { double d = at(0); L->setParam(I->p, &d, int(i)); break; }
      case kColor: { F0rColor c{float(at(0)), float(at(1)), float(at(2))}; L->setParam(I->p, &c, int(i)); break; }
      case kPosition: { F0rPosition q{at(0), at(1)}; L->setParam(I->p, &q, int(i)); break; }
      case kString: { std::string str = v.str(); const char *c = str.c_str(); L->setParam(I->p, &c, int(i)); break; }
      default: break;
    }
  }
  bool bgra = L->info.color_model == kBGRA;
  std::vector<uint32_t> in(size_t(pw) * ph), out(size_t(pw) * ph, 0);
  for (int y = 0; y < ph; ++y) {
    const unsigned char *row = f.in + size_t(std::min(y, f.h - 1)) * f.w * 4;
    unsigned char *d = reinterpret_cast<unsigned char *>(in.data() + size_t(y) * pw);
    for (int x = 0; x < pw; ++x, d += 4) {
      const unsigned char *px = row + size_t(std::min(x, f.w - 1)) * 4;
      if (bgra) { d[0] = px[2]; d[1] = px[1]; d[2] = px[0]; d[3] = px[3]; }
      else std::memcpy(d, px, 4);
    }
  }
  L->update(I->p, f.time, in.data(), out.data());
  for (int y = 0; y < f.h; ++y) {
    const unsigned char *srow = reinterpret_cast<const unsigned char *>(out.data() + size_t(y) * pw);
    unsigned char *d = f.out + size_t(y) * f.w * 4;
    for (int x = 0; x < f.w; ++x, d += 4, srow += 4) {
      if (bgra) { d[0] = srow[2]; d[1] = srow[1]; d[2] = srow[0]; d[3] = srow[3]; }
      else std::memcpy(d, srow, 4);
    }
  }
  return true;
}

}  // namespace xc
