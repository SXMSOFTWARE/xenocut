// `xenocut --fxhost`: the isolated effect-plug-in process. Requests arrive one JSON object per
// line on stdin, replies go out one per line on a private copy of stdout (fd 1 itself is pointed
// at stderr so chatty plug-ins can't corrupt the protocol). Frames travel through a file in
// /dev/shm laid out as [input RGBA8 w*h*4][output RGBA8 w*h*4], rows top-down.
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <iostream>
#include <string>

#include "frei0r_host.h"
#include "json.h"
#include "ofx_host.h"

namespace {

struct Shm {
  std::string path;
  size_t size = 0;
  unsigned char *p = nullptr;
  void close() {
    if (p) munmap(p, size);
    p = nullptr;
    size = 0;
    path.clear();
  }
  bool open(const std::string &file, size_t need) {
    if (p && path == file && size == need) return true;
    close();
    if (file.rfind("/dev/shm/", 0) != 0 || file.find("..") != std::string::npos) return false;
    int fd = ::open(file.c_str(), O_RDWR);
    if (fd < 0) return false;
    struct stat st;
    if (fstat(fd, &st) != 0 || size_t(st.st_size) < need) { ::close(fd); return false; }
    void *m = mmap(nullptr, need, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    ::close(fd);
    if (m == MAP_FAILED) return false;
    p = static_cast<unsigned char *>(m);
    size = need;
    path = file;
    return true;
  }
};

std::vector<std::string> strings(const xc::Json &a) {
  std::vector<std::string> v;
  for (const xc::Json &x : a.a)
    if (x.type == xc::Json::Str) v.push_back(x.s);
  return v;
}

std::string fail(const std::string &e) { return "{\"ok\":false,\"error\":" + xc::quote(e) + "}"; }

}  // namespace

extern "C" int xc_fxhost_main() {
  int proto = dup(1);
  dup2(2, 1);
  FILE *out = fdopen(proto, "w");
  if (!out) return 2;
  Shm shm;
  std::string line;
  while (std::getline(std::cin, line)) {
    xc::Json req = xc::Json::parse(line);
    std::string op = req["op"].str(), reply, err;
    std::string id = req["id"].str();
    bool f0r = id.rfind("frei0r:", 0) == 0;
    std::string bare = id.substr(id.find(':') == std::string::npos ? 0 : id.find(':') + 1);
    if (op == "ping") {
      reply = "{\"ok\":true,\"pid\":" + xc::num(getpid()) + "}";
    } else if (op == "scan") {
      std::string a, b;
      xc::ofxScan(strings(req["ofx"]), a);
      xc::f0rScan(strings(req["frei0r"]), b);
      reply = "{\"ok\":true,\"ofx\":" + a + ",\"frei0r\":" + b + "}";
    } else if (op == "describe") {
      bool ok = f0r ? xc::f0rDescribe(bare, reply, err) : xc::ofxDescribe(bare, reply, err);
      if (!ok) reply = fail(err);
    } else if (op == "render") {
      int w = int(req["w"].num()), h = int(req["h"].num());
      size_t bytes = size_t(w) * h * 4;
      if (w <= 0 || h <= 0 || w > 16384 || h > 16384) reply = fail("bad size");
      else if (!shm.open(req["shm"].str(), bytes * 2)) reply = fail("cannot map frame buffer");
      else {
        xc::Frame f;
        f.in = shm.p;
        f.out = shm.p + bytes;
        f.w = w;
        f.h = h;
        f.fullW = int(req["fullW"].num(w));
        f.fullH = int(req["fullH"].num(h));
        f.time = req["time"].num();
        f.fps = req["fps"].num(30);
        std::string key = req["key"].str(id);
        bool ok = f0r ? xc::f0rRender(bare, key, req["params"], f, err) : xc::ofxRender(bare, key, req["params"], f, err);
        reply = ok ? "{\"ok\":true}" : fail(err);
      }
    } else if (op == "drop") {
      xc::ofxDrop(req["key"].str());
      xc::f0rDrop(req["key"].str());
      reply = "{\"ok\":true}";
    } else if (op == "quit") {
      break;
    } else {
      reply = fail("unknown op " + op);
    }
    if (req["seq"].type == xc::Json::Num) reply.insert(1, "\"seq\":" + xc::num(req["seq"].num()) + ",");
    fputs(reply.c_str(), out);
    fputc('\n', out);
    fflush(out);
  }
  shm.close();
  xc::ofxShutdown();
  xc::f0rShutdown();
  fflush(out);
  // Skip static destructors: plug-ins commonly leave threads or globals that crash on teardown.
  _exit(0);
}
