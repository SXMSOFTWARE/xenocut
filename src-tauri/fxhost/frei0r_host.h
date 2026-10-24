// frei0r filter host (Linux). Plug-ins are plain shared objects; the API is declared locally
// (the ABI is declared in frei0r_host.cpp; no frei0r header is vendored).
#pragma once
#include <string>
#include <vector>

#include "json.h"
#include "ofx_host.h"

namespace xc {
void f0rScan(const std::vector<std::string> &files, std::string &json);
bool f0rDescribe(const std::string &id, std::string &json, std::string &err);
bool f0rRender(const std::string &id, const std::string &key, const Json &params, const Frame &f, std::string &err);
void f0rDrop(const std::string &key);
void f0rShutdown();
}  // namespace xc
