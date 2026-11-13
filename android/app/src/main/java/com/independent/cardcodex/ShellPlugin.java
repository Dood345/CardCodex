package com.independent.cardcodex;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the web app asks of the Android shell around it.
 *
 * setScrollbar: Android treats a pane that fills the screen as the page's own scroller and draws the system
 * scrollbar for it on the WebView itself, where no CSS reaches (scrollbar-width and ::-webkit-scrollbar were
 * both tried on the pane and on the document). The long lists have a scroll zone of their own
 * (src/ui/QuickScroll.tsx), and the system's thin bar showed beside it once the list was scrolled far enough
 * for its thumb to come out from under the top bar. The app turns it off while such a zone is up.
 */
@CapacitorPlugin(name = "Shell")
public class ShellPlugin extends Plugin {

    @PluginMethod
    public void setScrollbar(final PluginCall call) {
        final boolean shown = Boolean.TRUE.equals(call.getBoolean("shown", true));
        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().setVerticalScrollBarEnabled(shown);
            call.resolve();
        });
    }
}
