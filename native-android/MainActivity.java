package __PACKAGE__;

import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

// Installed into the generated Android project by the Build APK workflow
// (the android/ directory is created fresh in CI by `npx cap add android`,
// so this file is the source of truth — see .github/workflows/build-apk.yml).
//
// Why this exists: when the app sits in the background long enough, Android
// may kill the WebView's renderer process to reclaim memory. On resume the
// Activity survives but its WebView is dead — the screen paints solid black,
// no JS runs (so no error boundary can fire), and the only way out is a
// force-stop. Handling onRenderProcessGone and recreating the Activity makes
// Capacitor rebuild the WebView and reload the app automatically instead.
public class MainActivity extends BridgeActivity {

  @Override
  public void onStart() {
    super.onStart();
    Bridge bridge = getBridge();
    if (bridge == null || bridge.getWebView() == null) return;
    bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
      @Override
      public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        runOnUiThread(() -> recreate());
        return true; // handled — don't let the system kill the whole app process
      }
    });
  }
}
