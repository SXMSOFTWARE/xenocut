// OpenFX host on top of openfx HostSupport (BSD-3-Clause). Runs inside the isolated
// `xenocut --fxhost` process: a crashing plug-in only takes that helper down.
#include "ofx_host.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstring>
#include <iostream>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <thread>

#include <sys/stat.h>
#include <unistd.h>

#include "ofxCore.h"
#include "ofxImageEffect.h"
#include "ofxMessage.h"
#include "ofxPixels.h"
// HostSupport headers depend on each other in this order.
#include "ofxhBinary.h"
#include "ofxhPropertySuite.h"
#include "ofxhClip.h"
#include "ofxhParam.h"
#include "ofxhMemory.h"
#include "ofxhImageEffect.h"
#include "ofxhPluginAPICache.h"
#include "ofxhPluginCache.h"
#include "ofxhHost.h"
#include "ofxhImageEffectAPI.h"

namespace xc {
namespace {

using namespace OFX::Host;

// ---------------------------------------------------------------------------------------------
// Parameters: plain value stores, set from the editor before each render (no animation curves;
// the editor sends the value at the frame being rendered).

struct Store {
  std::vector<double> v;
  std::string s;
  void init(Property::Set &p, const std::string &type) {
    if (type == kOfxParamTypeString || type == kOfxParamTypeCustom) {
      if (p.getDimension(kOfxParamPropDefault) > 0) s = p.getStringProperty(kOfxParamPropDefault);
      return;
    }
    int n = p.getDimension(kOfxParamPropDefault);
    v.assign(std::max(n, 1), 0.0);
    for (int i = 0; i < n; ++i) {
      Property::Property *prop = p.fetchProperty(kOfxParamPropDefault);
      if (prop && prop->getType() == Property::eDouble) v[i] = p.getDoubleProperty(kOfxParamPropDefault, i);
      else if (prop && prop->getType() == Property::eInt) v[i] = p.getIntProperty(kOfxParamPropDefault, i);
    }
  }
  double at(size_t i) const { return i < v.size() ? v[i] : 0.0; }
  void put(size_t i, double x) {
    if (v.size() <= i) v.resize(i + 1, 0.0);
    v[i] = x;
  }
};

#define XC_STORE(Base)                                                                     \
  Store st;                                                                                \
  explicit X##Base(Param::Descriptor &d, Param::SetInstance *set) : Param::Base(d, set) { \
    st.init(getProperties(), d.getType());                                                 \
  }

struct XIntegerInstance : Param::IntegerInstance {
  XC_STORE(IntegerInstance)
  OfxStatus get(int &a) override { a = int(st.at(0)); return kOfxStatOK; }
  OfxStatus get(OfxTime, int &a) override { return get(a); }
  OfxStatus set(int a) override { st.put(0, a); return kOfxStatOK; }
  OfxStatus set(OfxTime, int a) override { return set(a); }
};
struct XChoiceInstance : Param::ChoiceInstance {
  XC_STORE(ChoiceInstance)
  OfxStatus get(int &a) override { a = int(st.at(0)); return kOfxStatOK; }
  OfxStatus get(OfxTime, int &a) override { return get(a); }
  OfxStatus set(int a) override { st.put(0, a); return kOfxStatOK; }
  OfxStatus set(OfxTime, int a) override { return set(a); }
};
struct XDoubleInstance : Param::DoubleInstance {
  XC_STORE(DoubleInstance)
  OfxStatus get(double &a) override { a = st.at(0); return kOfxStatOK; }
  OfxStatus get(OfxTime, double &a) override { return get(a); }
  OfxStatus set(double a) override { st.put(0, a); return kOfxStatOK; }
  OfxStatus set(OfxTime, double a) override { return set(a); }
  OfxStatus derive(OfxTime, double &a) override { a = 0; return kOfxStatOK; }
  OfxStatus integrate(OfxTime t1, OfxTime t2, double &a) override { a = st.at(0) * (t2 - t1); return kOfxStatOK; }
};
struct XBooleanInstance : Param::BooleanInstance {
  XC_STORE(BooleanInstance)
  OfxStatus get(bool &a) override { a = st.at(0) != 0; return kOfxStatOK; }
  OfxStatus get(OfxTime, bool &a) override { return get(a); }
  OfxStatus set(bool a) override { st.put(0, a ? 1 : 0); return kOfxStatOK; }
  OfxStatus set(OfxTime, bool a) override { return set(a); }
};
struct XRGBAInstance : Param::RGBAInstance {
  XC_STORE(RGBAInstance)
  OfxStatus get(double &r, double &g, double &b, double &a) override { r = st.at(0); g = st.at(1); b = st.at(2); a = st.at(3); return kOfxStatOK; }
  OfxStatus get(OfxTime, double &r, double &g, double &b, double &a) override { return get(r, g, b, a); }
  OfxStatus set(double r, double g, double b, double a) override { st.put(0, r); st.put(1, g); st.put(2, b); st.put(3, a); return kOfxStatOK; }
  OfxStatus set(OfxTime, double r, double g, double b, double a) override { return set(r, g, b, a); }
};
struct XRGBInstance : Param::RGBInstance {
  XC_STORE(RGBInstance)
  OfxStatus get(double &r, double &g, double &b) override { r = st.at(0); g = st.at(1); b = st.at(2); return kOfxStatOK; }
  OfxStatus get(OfxTime, double &r, double &g, double &b) override { return get(r, g, b); }
  OfxStatus set(double r, double g, double b) override { st.put(0, r); st.put(1, g); st.put(2, b); return kOfxStatOK; }
  OfxStatus set(OfxTime, double r, double g, double b) override { return set(r, g, b); }
};
struct XDouble2DInstance : Param::Double2DInstance {
  XC_STORE(Double2DInstance)
  OfxStatus get(double &x, double &y) override { x = st.at(0); y = st.at(1); return kOfxStatOK; }
  OfxStatus get(OfxTime, double &x, double &y) override { return get(x, y); }
  OfxStatus set(double x, double y) override { st.put(0, x); st.put(1, y); return kOfxStatOK; }
  OfxStatus set(OfxTime, double x, double y) override { return set(x, y); }
};
struct XInteger2DInstance : Param::Integer2DInstance {
  XC_STORE(Integer2DInstance)
  OfxStatus get(int &x, int &y) override { x = int(st.at(0)); y = int(st.at(1)); return kOfxStatOK; }
  OfxStatus get(OfxTime, int &x, int &y) override { return get(x, y); }
  OfxStatus set(int x, int y) override { st.put(0, x); st.put(1, y); return kOfxStatOK; }
  OfxStatus set(OfxTime, int x, int y) override { return set(x, y); }
};
struct XDouble3DInstance : Param::Double3DInstance {
  XC_STORE(Double3DInstance)
  OfxStatus get(double &x, double &y, double &z) override { x = st.at(0); y = st.at(1); z = st.at(2); return kOfxStatOK; }
  OfxStatus get(OfxTime, double &x, double &y, double &z) override { return get(x, y, z); }
  OfxStatus set(double x, double y, double z) override { st.put(0, x); st.put(1, y); st.put(2, z); return kOfxStatOK; }
  OfxStatus set(OfxTime, double x, double y, double z) override { return set(x, y, z); }
};
struct XInteger3DInstance : Param::Integer3DInstance {
  XC_STORE(Integer3DInstance)
  OfxStatus get(int &x, int &y, int &z) override { x = int(st.at(0)); y = int(st.at(1)); z = int(st.at(2)); return kOfxStatOK; }
  OfxStatus get(OfxTime, int &x, int &y, int &z) override { return get(x, y, z); }
  OfxStatus set(int x, int y, int z) override { st.put(0, x); st.put(1, y); st.put(2, z); return kOfxStatOK; }
  OfxStatus set(OfxTime, int x, int y, int z) override { return set(x, y, z); }
};
struct XStringInstance : Param::StringInstance {
  XC_STORE(StringInstance)
  OfxStatus get(std::string &a) override { a = st.s; return kOfxStatOK; }
  OfxStatus get(OfxTime, std::string &a) override { return get(a); }
  OfxStatus set(const char *a) override { st.s = a ? a : ""; return kOfxStatOK; }
  OfxStatus set(OfxTime, const char *a) override { return set(a); }
};
struct XCustomInstance : Param::CustomInstance {
  XC_STORE(CustomInstance)
  OfxStatus get(std::string &a) override { a = st.s; return kOfxStatOK; }
  OfxStatus get(OfxTime, std::string &a) override { return get(a); }
  OfxStatus set(const char *a) override { st.s = a ? a : ""; return kOfxStatOK; }
  OfxStatus set(OfxTime, const char *a) override { return set(a); }
};

Store *storeOf(Param::Instance *p) {
#define XC_TRY(T) if (auto *x = dynamic_cast<T *>(p)) return &x->st;
  XC_TRY(XIntegerInstance) XC_TRY(XChoiceInstance) XC_TRY(XDoubleInstance) XC_TRY(XBooleanInstance)
  XC_TRY(XRGBAInstance) XC_TRY(XRGBInstance) XC_TRY(XDouble2DInstance) XC_TRY(XInteger2DInstance)
  XC_TRY(XDouble3DInstance) XC_TRY(XInteger3DInstance) XC_TRY(XStringInstance) XC_TRY(XCustomInstance)
#undef XC_TRY
  return nullptr;
}

// ---------------------------------------------------------------------------------------------
// Images and clips. Pixels live in per-effect buffers in OFX layout (rows bottom-up) at the
// depth the plug-in negotiated in its clip preferences.

struct Buffer {
  std::vector<unsigned char> data;
  int w = 0, h = 0, comps = 4, bytes = 1;  // bytes per component
  int rowBytes() const { return w * comps * bytes; }
};

int depthBytes(const std::string &d) {
  if (d == kOfxBitDepthFloat) return 4;
  if (d == kOfxBitDepthShort) return 2;
  return 1;
}
int componentCount(const std::string &c) {
  if (c == kOfxImageComponentAlpha) return 1;
  if (c == kOfxImageComponentRGB) return 3;
  return 4;
}

class XEffect;

class XClip : public ImageEffect::ClipInstance {
 public:
  XClip(XEffect *fx, ImageEffect::ClipDescriptor *d);
  const std::string &getUnmappedBitDepth() const override { static const std::string v(kOfxBitDepthByte); return v; }
  const std::string &getUnmappedComponents() const override { static const std::string v(kOfxImageComponentRGBA); return v; }
  const std::string &getPremult() const override { static const std::string v(kOfxImageUnPreMultiplied); return v; }
  double getAspectRatio() const override { return 1.0; }
  double getFrameRate() const override;
  void getFrameRange(double &a, double &b) const override { a = 0; b = 1e6; }
  const std::string &getFieldOrder() const override { static const std::string v(kOfxImageFieldNone); return v; }
  // Only Source and Output are wired; masks and extra inputs read as disconnected.
  bool getConnected() const override { return _name == kOfxImageEffectSimpleSourceClipName || _name == kOfxImageEffectOutputClipName; }
  double getUnmappedFrameRate() const override { return getFrameRate(); }
  void getUnmappedFrameRange(double &a, double &b) const override { a = 0; b = 1e6; }
  bool getContinuousSamples() const override { return false; }
  ImageEffect::Image *getImage(OfxTime time, const OfxRectD *bounds) override;
  OfxRectD getRegionOfDefinition(OfxTime time) const override;

 private:
  XEffect *_fx;
  std::string _name;
};

class XEffect : public ImageEffect::Instance {
 public:
  XEffect(ImageEffect::ImageEffectPlugin *plugin, ImageEffect::Descriptor &desc, const std::string &context)
      : ImageEffect::Instance(plugin, desc, context, false) {}

  Buffer src, dst;
  double fullW = 1920, fullH = 1080, scaleX = 1, scaleY = 1, fps = 30, frame = 0;

  const std::string &getDefaultOutputFielding() const override { static const std::string v(kOfxImageFieldNone); return v; }
  ImageEffect::ClipInstance *newClipInstance(ImageEffect::Instance *, ImageEffect::ClipDescriptor *d, int) override {
    return new XClip(this, d);
  }
  OfxStatus vmessage(const char *type, const char *, const char *format, va_list args) override {
    char buf[1024];
    vsnprintf(buf, sizeof buf, format, args);
    std::cerr << "[ofx " << type << "] " << buf << std::endl;
    if (type && std::strcmp(type, kOfxMessageQuestion) == 0) return kOfxStatReplyYes;
    return kOfxStatOK;
  }
  OfxStatus setPersistentMessage(const char *type, const char *id, const char *format, va_list args) override {
    return vmessage(type, id, format, args);
  }
  OfxStatus clearPersistentMessage() override { return kOfxStatOK; }
  void getProjectSize(double &x, double &y) const override { x = fullW; y = fullH; }
  void getProjectOffset(double &x, double &y) const override { x = y = 0; }
  void getProjectExtent(double &x, double &y) const override { x = fullW; y = fullH; }
  double getProjectPixelAspectRatio() const override { return 1.0; }
  double getEffectDuration() const override { return 1e6; }
  double getFrameRate() const override { return fps; }
  double getFrameRecursive() const override { return frame; }
  void getRenderScaleRecursive(double &x, double &y) const override { x = scaleX; y = scaleY; }
  Param::Instance *newParam(const std::string &, Param::Descriptor &d) override {
    const std::string &t = d.getType();
    if (t == kOfxParamTypeInteger) return new XIntegerInstance(d, this);
    if (t == kOfxParamTypeDouble) return new XDoubleInstance(d, this);
    if (t == kOfxParamTypeBoolean) return new XBooleanInstance(d, this);
    if (t == kOfxParamTypeChoice) return new XChoiceInstance(d, this);
    if (t == kOfxParamTypeRGBA) return new XRGBAInstance(d, this);
    if (t == kOfxParamTypeRGB) return new XRGBInstance(d, this);
    if (t == kOfxParamTypeDouble2D) return new XDouble2DInstance(d, this);
    if (t == kOfxParamTypeInteger2D) return new XInteger2DInstance(d, this);
    if (t == kOfxParamTypeDouble3D) return new XDouble3DInstance(d, this);
    if (t == kOfxParamTypeInteger3D) return new XInteger3DInstance(d, this);
    if (t == kOfxParamTypeString) return new XStringInstance(d, this);
    if (t == kOfxParamTypeCustom) return new XCustomInstance(d, this);
    if (t == kOfxParamTypePushButton) return new Param::PushbuttonInstance(d, this);
    if (t == kOfxParamTypeGroup) return new Param::GroupInstance(d, this);
    if (t == kOfxParamTypePage) return new Param::PageInstance(d, this);
    return nullptr;
  }
  OfxStatus editBegin(const std::string &) override { return kOfxStatOK; }
  OfxStatus editEnd() override { return kOfxStatOK; }
  void progressStart(const std::string &, const std::string &) override {}
  void progressEnd() override {}
  bool progressUpdate(double) override { return true; }
  double timeLineGetTime() override { return frame; }
  void timeLineGotoTime(double) override {}
  void timeLineGetBounds(double &a, double &b) override { a = 0; b = 1e6; }
};

double XClip::getFrameRate() const { return _fx->fps; }

XClip::XClip(XEffect *fx, ImageEffect::ClipDescriptor *d) : ImageEffect::ClipInstance(fx, *d), _fx(fx), _name(d->getName()) {}

OfxRectD XClip::getRegionOfDefinition(OfxTime) const {
  OfxRectD r = {0, 0, _fx->fullW, _fx->fullH};
  return r;
}

ImageEffect::Image *XClip::getImage(OfxTime, const OfxRectD *) {
  if (!getConnected()) return nullptr;
  Buffer &b = isOutput() ? _fx->dst : _fx->src;
  if (b.data.empty()) return nullptr;
  OfxRectI rect = {0, 0, b.w, b.h};
  // The clip's mapped depth/components (from the plug-in's clip preferences) are what the
  // buffers were prepared with; Image() copies them from the clip.
  return new ImageEffect::Image(*this, _fx->scaleX, _fx->scaleY, b.data.data(), rect, rect, b.rowBytes(), kOfxImageFieldNone, "xc");
}

// ---------------------------------------------------------------------------------------------
// The host descriptor

class XHost : public ImageEffect::Host {
 public:
  XHost() {
    _properties.setStringProperty(kOfxPropName, "com.xenocut.XenoCut");
    _properties.setStringProperty(kOfxPropLabel, "XenoCut");
    _properties.setIntProperty(kOfxPropAPIVersion, 1, 0);
    _properties.setIntProperty(kOfxPropAPIVersion, 4, 1);
    _properties.setIntProperty(kOfxPropVersion, 0, 0);
    _properties.setIntProperty(kOfxPropVersion, 7, 1);
    _properties.setStringProperty(kOfxPropVersionLabel, "0.7");
    _properties.setIntProperty(kOfxImageEffectHostPropIsBackground, 1);
    _properties.setIntProperty(kOfxImageEffectPropSupportsOverlays, 0);
    _properties.setIntProperty(kOfxImageEffectPropSupportsMultiResolution, 0);
    _properties.setIntProperty(kOfxImageEffectPropSupportsTiles, 0);
    _properties.setIntProperty(kOfxImageEffectPropTemporalClipAccess, 0);
    _properties.setStringProperty(kOfxImageEffectPropSupportedComponents, kOfxImageComponentRGBA, 0);
    _properties.setStringProperty(kOfxImageEffectPropSupportedComponents, kOfxImageComponentAlpha, 1);
    _properties.setStringProperty(kOfxImageEffectPropSupportedContexts, kOfxImageEffectContextFilter, 0);
    _properties.setStringProperty(kOfxImageEffectPropSupportedContexts, kOfxImageEffectContextGeneral, 1);
    _properties.setStringProperty(kOfxImageEffectPropSupportedPixelDepths, kOfxBitDepthByte, 0);
    _properties.setStringProperty(kOfxImageEffectPropSupportedPixelDepths, kOfxBitDepthShort, 1);
    _properties.setStringProperty(kOfxImageEffectPropSupportedPixelDepths, kOfxBitDepthFloat, 2);
    _properties.setIntProperty(kOfxImageEffectPropSupportsMultipleClipDepths, 0);
    _properties.setIntProperty(kOfxImageEffectPropSupportsMultipleClipPARs, 0);
    _properties.setIntProperty(kOfxImageEffectPropSetableFrameRate, 0);
    _properties.setIntProperty(kOfxImageEffectPropSetableFielding, 0);
    _properties.setIntProperty(kOfxParamHostPropSupportsCustomInteract, 0);
    _properties.setIntProperty(kOfxParamHostPropSupportsStringAnimation, 0);
    _properties.setIntProperty(kOfxParamHostPropSupportsChoiceAnimation, 0);
    _properties.setIntProperty(kOfxParamHostPropSupportsBooleanAnimation, 0);
    _properties.setIntProperty(kOfxParamHostPropSupportsCustomAnimation, 0);
    _properties.setIntProperty(kOfxParamHostPropMaxParameters, -1);
    _properties.setIntProperty(kOfxParamHostPropMaxPages, 0);
    _properties.setIntProperty(kOfxParamHostPropPageRowColumnCount, 0, 0);
    _properties.setIntProperty(kOfxParamHostPropPageRowColumnCount, 0, 1);
  }
  ImageEffect::Instance *newInstance(void *, ImageEffect::ImageEffectPlugin *plugin, ImageEffect::Descriptor &desc, const std::string &context) override {
    return new XEffect(plugin, desc, context);
  }
  ImageEffect::Descriptor *makeDescriptor(ImageEffect::ImageEffectPlugin *plugin) override { return new ImageEffect::Descriptor(plugin); }
  ImageEffect::Descriptor *makeDescriptor(const ImageEffect::Descriptor &root, ImageEffect::ImageEffectPlugin *plugin) override {
    return new ImageEffect::Descriptor(root, plugin);
  }
  ImageEffect::Descriptor *makeDescriptor(const std::string &bundle, ImageEffect::ImageEffectPlugin *plugin) override {
    return new ImageEffect::Descriptor(bundle, plugin);
  }
  OfxStatus vmessage(const char *type, const char *, const char *format, va_list args) override {
    char buf[1024];
    vsnprintf(buf, sizeof buf, format, args);
    std::cerr << "[ofx host " << type << "] " << buf << std::endl;
    return kOfxStatOK;
  }
  OfxStatus setPersistentMessage(const char *type, const char *id, const char *format, va_list args) override {
    return vmessage(type, id, format, args);
  }
  OfxStatus clearPersistentMessage() override { return kOfxStatOK; }

  // Multithread suite: a plain thread fan-out (plug-ins split their render windows).
  OfxStatus multiThread(OfxThreadFunctionV1 func, unsigned int n, void *arg) override {
    if (!func) return kOfxStatFailed;
    unsigned cpus = 1;
    multiThreadNumCPUS(&cpus);
    if (n == 0 || n > cpus) n = cpus;
    if (n <= 1 || tIndex() >= 0) {
      for (unsigned i = 0; i < n; ++i) func(i, n, arg);
      return kOfxStatOK;
    }
    std::vector<std::thread> threads;
    for (unsigned i = 0; i < n; ++i)
      threads.emplace_back([=] {
        tIndex() = int(i);
        func(i, n, arg);
        tIndex() = -1;
      });
    for (auto &t : threads) t.join();
    return kOfxStatOK;
  }
  OfxStatus multiThreadNumCPUS(unsigned int *n) const override {
    if (!n) return kOfxStatFailed;
    unsigned c = std::thread::hardware_concurrency();
    *n = std::max(1u, std::min(c ? c : 1u, 16u));
    return kOfxStatOK;
  }
  OfxStatus multiThreadIndex(unsigned int *i) const override {
    if (!i) return kOfxStatFailed;
    *i = tIndex() < 0 ? 0 : unsigned(tIndex());
    return kOfxStatOK;
  }
  int multiThreadIsSpawnedThread() const override { return tIndex() >= 0; }
  OfxStatus mutexCreate(OfxMutexHandle *m, int) override {
    if (!m) return kOfxStatFailed;
    *m = reinterpret_cast<OfxMutexHandle>(new std::recursive_mutex);
    return kOfxStatOK;
  }
  OfxStatus mutexDestroy(const OfxMutexHandle m) override {
    delete reinterpret_cast<std::recursive_mutex *>(m);
    return kOfxStatOK;
  }
  OfxStatus mutexLock(const OfxMutexHandle m) override {
    if (!m) return kOfxStatErrBadHandle;
    reinterpret_cast<std::recursive_mutex *>(m)->lock();
    return kOfxStatOK;
  }
  OfxStatus mutexUnLock(const OfxMutexHandle m) override {
    if (!m) return kOfxStatErrBadHandle;
    reinterpret_cast<std::recursive_mutex *>(m)->unlock();
    return kOfxStatOK;
  }
  OfxStatus mutexTryLock(const OfxMutexHandle m) override {
    if (!m) return kOfxStatErrBadHandle;
    return reinterpret_cast<std::recursive_mutex *>(m)->try_lock() ? kOfxStatOK : kOfxStatFailed;
  }

 private:
  static int &tIndex() {
    thread_local int i = -1;
    return i;
  }
};

// ---------------------------------------------------------------------------------------------

struct State {
  XHost host;
  std::unique_ptr<ImageEffect::PluginCache> cache;
  bool scanned = false;
  struct Live {
    std::unique_ptr<XEffect> fx;
    std::string id;
    std::map<std::string, std::string> last;  // param name -> serialised value last applied
    unsigned long long used = 0;
  };
  std::map<std::string, Live> live;
  unsigned long long tick = 0;
};

State &state() {
  static State *s = new State;  // never destroyed: plug-in statics may outlive any order we pick
  return *s;
}

std::string pickContext(ImageEffect::ImageEffectPlugin *p) {
  const std::set<std::string> &c = p->getContexts();
  if (c.count(kOfxImageEffectContextFilter)) return kOfxImageEffectContextFilter;
  if (c.count(kOfxImageEffectContextGeneral)) return kOfxImageEffectContextGeneral;
  return "";
}

std::string prop(const Property::Set &p, const char *name, int i = 0) {
  Property::Property *x = p.fetchProperty(name);
  if (!x || x->getDimension() <= i) return "";
  return p.getStringProperty(name, i);
}

void numbers(const Property::Set &p, const char *name, std::string &out) {
  Property::Property *x = p.fetchProperty(name);
  out += "[";
  if (x)
    for (int i = 0; i < x->getDimension(); ++i) {
      if (i) out += ",";
      out += num(x->getType() == Property::eDouble ? p.getDoubleProperty(name, i) : p.getIntProperty(name, i));
    }
  out += "]";
}

ImageEffect::ImageEffectPlugin *find(const std::string &id) {
  State &s = state();
  if (!s.cache) return nullptr;
  return s.cache->getPluginById(id);
}

}  // namespace

void ofxScan(const std::vector<std::string> &bundles, std::string &json) {
  State &s = state();
  if (!s.scanned) {
    // Only the bundles the supervisor allows (it drops the ones that crashed a helper): link
    // them into a private directory and scan just that.
    char dir[256];
    snprintf(dir, sizeof dir, "/tmp/xc-ofx-%d", int(getpid()));
    mkdir(dir, 0700);
    for (const std::string &b : bundles) {
      std::string name = b.substr(b.find_last_of('/') + 1);
      std::string link = std::string(dir) + "/" + name;
      unlink(link.c_str());
      if (symlink(b.c_str(), link.c_str()) != 0) std::cerr << "[fxhost] cannot link " << b << std::endl;
    }
    PluginCache::useStdOFXPluginsLocation(false);
    PluginCache *pc = PluginCache::getPluginCache();
    pc->setCacheVersion("XenoCutV1");
    s.cache.reset(new ImageEffect::PluginCache(&s.host));
    s.cache->registerInCache(*pc);
    pc->addFileToPath(dir, false);
    pc->scanPluginFiles();
    s.scanned = true;
  }
  json = "{\"ok\":true,\"plugins\":[";
  bool first = true;
  for (ImageEffect::ImageEffectPlugin *p : s.cache->getPlugins()) {
    std::string ctx = pickContext(p);
    if (ctx.empty()) continue;
    // Single-input filters only: multi-input mergers/keyers need wiring the editor lacks.
    ImageEffect::Descriptor *cd = p->getContext(ctx);
    if (!cd || !cd->getClips().count(kOfxImageEffectSimpleSourceClipName) || !cd->getClips().count(kOfxImageEffectOutputClipName)) continue;
    bool extraRequired = false;
    for (auto &c : cd->getClips())
      if (c.first != kOfxImageEffectSimpleSourceClipName && c.first != kOfxImageEffectOutputClipName && !c.second->isOptional()) extraRequired = true;
    if (extraRequired) continue;
    ImageEffect::Descriptor &d = p->getDescriptor();
    const Property::Set &pr = d.getProps();
    std::string label = prop(pr, kOfxPropLabel);
    if (label.empty()) label = p->getIdentifier();
    if (!first) json += ",";
    first = false;
    json += "{\"id\":" + quote(p->getIdentifier()) + ",\"label\":" + quote(label) +
            ",\"group\":" + quote(prop(pr, kOfxImageEffectPluginPropGrouping)) +
            ",\"description\":" + quote(prop(pr, kOfxPropPluginDescription)) +
            ",\"version\":[" + num(p->getVersionMajor()) + "," + num(p->getVersionMinor()) + "]" +
            ",\"context\":" + quote(ctx) +
            ",\"bundle\":" + quote(p->getBinary()->getBundlePath()) + "}";
  }
  json += "]}";
}

bool ofxDescribe(const std::string &id, std::string &json, std::string &err) {
  ImageEffect::ImageEffectPlugin *p = find(id);
  if (!p) { err = "unknown plug-in " + id; return false; }
  std::string ctx = pickContext(p);
  ImageEffect::Descriptor *d = ctx.empty() ? nullptr : p->getContext(ctx);
  if (!d) { err = "no filter context"; return false; }
  json = "{\"ok\":true,\"context\":" + quote(ctx) + ",\"clips\":[";
  bool first = true;
  for (auto &c : d->getClips()) {
    if (!first) json += ",";
    first = false;
    json += "{\"name\":" + quote(c.first) + ",\"optional\":" + (c.second->isOptional() ? "true" : "false") + "}";
  }
  json += "],\"params\":[";
  first = true;
  for (Param::Descriptor *pd : d->getParamList()) {
    const Property::Set &pp = pd->getProperties();
    if (!first) json += ",";
    first = false;
    json += "{\"name\":" + quote(pd->getName()) + ",\"type\":" + quote(pd->getType()) +
            ",\"label\":" + quote(prop(pp, kOfxPropLabel)) + ",\"hint\":" + quote(prop(pp, kOfxParamPropHint)) +
            ",\"parent\":" + quote(prop(pp, kOfxParamPropParent)) +
            ",\"secret\":" + (pp.fetchProperty(kOfxParamPropSecret) && pp.getIntProperty(kOfxParamPropSecret) ? "true" : "false") +
            ",\"doubleType\":" + quote(prop(pp, kOfxParamPropDoubleType)) +
            ",\"stringMode\":" + quote(prop(pp, kOfxParamPropStringMode));
    if (pd->getType() == kOfxParamTypeString || pd->getType() == kOfxParamTypeCustom) {
      json += ",\"default\":" + quote(prop(pp, kOfxParamPropDefault));
    } else {
      json += ",\"default\":";
      numbers(pp, kOfxParamPropDefault, json);
    }
    json += ",\"min\":";
    numbers(pp, kOfxParamPropMin, json);
    json += ",\"max\":";
    numbers(pp, kOfxParamPropMax, json);
    json += ",\"displayMin\":";
    numbers(pp, kOfxParamPropDisplayMin, json);
    json += ",\"displayMax\":";
    numbers(pp, kOfxParamPropDisplayMax, json);
    Property::Property *opts = pp.fetchProperty(kOfxParamPropChoiceOption);
    if (opts) {
      json += ",\"choices\":[";
      for (int i = 0; i < opts->getDimension(); ++i) json += (i ? "," : "") + quote(pp.getStringProperty(kOfxParamPropChoiceOption, i));
      json += "]";
    }
    json += "}";
  }
  json += "]}";
  return true;
}

void ofxDrop(const std::string &key) { state().live.erase(key); }

void ofxShutdown() { state().live.clear(); }

namespace {

// 8-bit RGBA top-down -> plug-in buffer (bottom-up, negotiated depth/components)
void importFrame(const Frame &f, Buffer &b) {
  b.w = f.w;
  b.h = f.h;
  b.data.assign(size_t(b.rowBytes()) * b.h, 0);
  for (int y = 0; y < f.h; ++y) {
    const unsigned char *s = f.in + size_t(f.h - 1 - y) * f.w * 4;
    unsigned char *d = b.data.data() + size_t(y) * b.rowBytes();
    for (int x = 0; x < f.w; ++x, s += 4) {
      for (int c = 0; c < b.comps; ++c) {
        int sc = b.comps == 1 ? 3 : c;
        unsigned char v = s[sc];
        if (b.bytes == 1) d[c] = v;
        else if (b.bytes == 2) reinterpret_cast<unsigned short *>(d)[c] = (unsigned short)(v * 257);
        else reinterpret_cast<float *>(d)[c] = v / 255.f;
      }
      d += b.comps * b.bytes;
    }
  }
}

unsigned char clamp8(float v) {
  if (!(v > 0)) return 0;
  if (v >= 1) return 255;
  return (unsigned char)std::lround(v * 255.f);
}

void exportFrame(const Buffer &b, const Frame &f) {
  for (int y = 0; y < f.h; ++y) {
    const unsigned char *s = b.data.data() + size_t(f.h - 1 - y) * b.rowBytes();
    unsigned char *d = f.out + size_t(y) * f.w * 4;
    for (int x = 0; x < f.w; ++x, d += 4) {
      float px[4] = {0, 0, 0, 1};
      for (int c = 0; c < b.comps; ++c) {
        float v = b.bytes == 1 ? s[c] / 255.f
                  : b.bytes == 2 ? reinterpret_cast<const unsigned short *>(s)[c] / 65535.f
                                 : reinterpret_cast<const float *>(s)[c];
        if (b.comps == 1) px[0] = px[1] = px[2] = px[3] = v;
        else px[c] = v;
      }
      if (b.comps == 1) px[3] = 1;
      for (int c = 0; c < 4; ++c) d[c] = clamp8(px[c]);
      s += b.comps * b.bytes;
    }
  }
}

std::string serial(const Json &v) {
  if (v.type == Json::Str) return "s" + v.s;
  if (v.type == Json::Arr) {
    std::string o = "a";
    for (const Json &x : v.a) o += num(x.num()) + ",";
    return o;
  }
  return "n" + num(v.num());
}

}  // namespace

bool ofxRender(const std::string &id, const std::string &key, const Json &params, const Frame &f, std::string &err) {
  State &s = state();
  State::Live &L = s.live[key];
  L.used = ++s.tick;
  if (!L.fx || L.id != id) {
    L.fx.reset();
    L.last.clear();
    ImageEffect::ImageEffectPlugin *p = find(id);
    if (!p) { s.live.erase(key); err = "unknown plug-in " + id; return false; }
    std::string ctx = pickContext(p);
    ImageEffect::Instance *inst = ctx.empty() ? nullptr : p->createInstance(ctx, nullptr);
    XEffect *fx = dynamic_cast<XEffect *>(inst);
    if (!fx) { delete inst; s.live.erase(key); err = "cannot create instance"; return false; }
    L.fx.reset(fx);
    L.id = id;
    fx->fullW = f.fullW;
    fx->fullH = f.fullH;
    fx->fps = f.fps;
    OfxStatus st = fx->createInstanceAction();
    if (st != kOfxStatOK && st != kOfxStatReplyDefault) { s.live.erase(key); err = "createInstance failed"; return false; }
    // Evict the least recently used instances beyond a small working set.
    while (s.live.size() > 24) {
      auto victim = s.live.end();
      for (auto it = s.live.begin(); it != s.live.end(); ++it)
        if (it->first != key && (victim == s.live.end() || it->second.used < victim->second.used)) victim = it;
      if (victim == s.live.end()) break;
      s.live.erase(victim);
    }
  }
  XEffect *fx = L.fx.get();
  fx->fullW = f.fullW;
  fx->fullH = f.fullH;
  fx->fps = f.fps > 0 ? f.fps : 30;
  fx->frame = std::floor(f.time * fx->fps + 1e-6);
  fx->scaleX = double(f.w) / f.fullW;
  fx->scaleY = double(f.h) / f.fullH;
  OfxTime t = fx->frame;

  // Parameters: apply the changed ones and tell the plug-in, as a host UI edit would.
  std::vector<std::string> changed;
  if (params.type == Json::Obj)
    for (auto &kv : params.o) {
      Param::Instance *pi = fx->getParams().count(kv.first) ? fx->getParams().at(kv.first) : nullptr;
      Store *st = pi ? storeOf(pi) : nullptr;
      if (!st) continue;
      std::string sv = serial(kv.second);
      if (L.last[kv.first] == sv) continue;
      L.last[kv.first] = sv;
      if (kv.second.type == Json::Str) st->s = kv.second.s;
      else if (kv.second.type == Json::Arr)
        for (size_t i = 0; i < kv.second.a.size(); ++i) st->put(i, kv.second.a[i].num());
      else st->put(0, kv.second.num());
      changed.push_back(kv.first);
    }
  if (!changed.empty()) {
    OfxPointD one = {1, 1};
    fx->beginInstanceChangedAction(kOfxChangeUserEdited);
    for (const std::string &n : changed) fx->paramInstanceChangedAction(n, kOfxChangeUserEdited, t, one);
    fx->endInstanceChangedAction(kOfxChangeUserEdited);
  }
  fx->getClipPreferences();

  ImageEffect::ClipInstance *in = fx->getClip(kOfxImageEffectSimpleSourceClipName);
  ImageEffect::ClipInstance *out = fx->getClip(kOfxImageEffectOutputClipName);
  if (!in || !out) { err = "plug-in has no Source/Output clip"; return false; }
  fx->src.comps = componentCount(in->getComponents());
  fx->src.bytes = depthBytes(in->getPixelDepth());
  fx->dst.comps = componentCount(out->getComponents());
  fx->dst.bytes = depthBytes(out->getPixelDepth());
  if (getenv("XENOCUT_FX_DEBUG"))
    std::cerr << "[fxhost] " << id << " in " << in->getPixelDepth() << "/" << in->getComponents() << " out "
              << out->getPixelDepth() << "/" << out->getComponents() << std::endl;
  importFrame(f, fx->src);
  fx->dst.w = f.w;
  fx->dst.h = f.h;
  fx->dst.data.assign(size_t(fx->dst.rowBytes()) * f.h, 0);

  OfxPointD scale = {fx->scaleX, fx->scaleY};
  OfxRectI window = {0, 0, f.w, f.h};
  // Identity (e.g. mix 0, or a no-op setting): pass the source through untouched.
  {
    OfxTime it = t;
    std::string clip;
    if (fx->isIdentityAction(it, kOfxImageFieldNone, window, scale, clip) == kOfxStatOK && !clip.empty()) {
      std::memcpy(f.out, f.in, size_t(f.w) * f.h * 4);
      return true;
    }
  }
  OfxStatus st = fx->beginRenderAction(t, t, 1, false, scale, true, false, false);
  if (st != kOfxStatOK && st != kOfxStatReplyDefault) { err = "beginRender failed"; return false; }
  st = fx->renderAction(t, kOfxImageFieldNone, window, scale, true, false, false);
  fx->endRenderAction(t, t, 1, false, scale, true, false, false);
  if (st != kOfxStatOK) { err = "render failed (" + std::to_string(st) + ")"; return false; }
  exportFrame(fx->dst, f);
  return true;
}

}  // namespace xc
