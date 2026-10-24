// OpenFX image-effect host built on the openfx HostSupport library: plugin discovery,
// parameter description and frame rendering on 8-bit RGBA buffers.
#pragma once
#include <string>
#include <vector>
#include "json.h"

namespace xc {

/// One render: `in`/`out` are w*h RGBA8, rows top-down. `fullW/fullH` is the project frame size
/// the image is a scaled-down copy of (render scale = w/fullW), so spatial params keep their
/// meaning at preview resolution.
struct Frame {
  const unsigned char *in;
  unsigned char *out;
  int w, h, fullW, fullH;
  double time;  // seconds
  double fps;
};

void ofxScan(const std::vector<std::string> &bundles, std::string &json);
bool ofxDescribe(const std::string &id, std::string &json, std::string &err);
bool ofxRender(const std::string &id, const std::string &key, const Json &params, const Frame &f, std::string &err);
void ofxDrop(const std::string &key);
// Destroy every live instance (destroyInstance actions run while plug-ins are still loaded).
void ofxShutdown();

}  // namespace xc
