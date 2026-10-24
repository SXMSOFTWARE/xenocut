// What the web view's media stack can decode. WebKitGTK answers canPlayType from the GStreamer
// plugins it actually has, so a build without an H.264/AAC decoder (the AppImage's bundled
// GStreamer has VP8/VP9/Opus/Vorbis only) reports "" here, and previews go through WebM proxies.

let cached: { h264: boolean; aac: boolean } | null = null;

export function codecSupport() {
  if (cached) return cached;
  const v = document.createElement("video");
  cached = {
    h264: v.canPlayType('video/mp4; codecs="avc1.640028"') !== "",
    aac: v.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== "",
  };
  return cached;
}

/** The proxy codec this web view can always play. */
export function proxyCodec(): "h264" | "webm" {
  const c = codecSupport();
  return c.h264 && c.aac ? "h264" : "webm";
}

/** True when common camera / export files (H.264 + AAC) need a proxy to preview at all. */
export function needsDecodeProxy(): boolean {
  return proxyCodec() === "webm";
}
