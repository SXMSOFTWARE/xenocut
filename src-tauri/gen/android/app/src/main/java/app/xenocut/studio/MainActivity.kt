package app.xenocut.studio

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Edge-to-edge: the WebView draws under the status and navigation bars. Android WebView does not
  // report those bars through env(safe-area-inset-*), so the real insets (in CSS px) and the
  // system font scale are handed to the page through `window.XenoNative`, and an `xc-insets`
  // event fires whenever they change (rotation, keyboard, gesture/3-button nav switch).
  @Volatile private var insetsJson = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0,\"ime\":0}"

  inner class NativeBridge {
    @JavascriptInterface fun insets(): String = insetsJson
    @JavascriptInterface fun fontScale(): Float = resources.configuration.fontScale
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    // The layout is in CSS px; WebView would otherwise multiply every font by the system font scale
    // and break fixed-height controls. The scale is applied in CSS instead (capped, see platform.ts).
    webView.settings.textZoom = 100
    webView.addJavascriptInterface(NativeBridge(), "XenoNative")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val d = v.resources.displayMetrics.density
      fun px(n: Int) = Math.round(n / d)
      insetsJson = "{\"top\":${px(bars.top)},\"right\":${px(bars.right)},\"bottom\":${px(bars.bottom)},\"left\":${px(bars.left)},\"ime\":${px(ime.bottom)}}"
      v.post { webView.evaluateJavascript("window.dispatchEvent(new Event('xc-insets'))", null) }
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }
}
