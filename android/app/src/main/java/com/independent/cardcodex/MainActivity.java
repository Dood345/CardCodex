package com.independent.cardcodex;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, which builds the bridge with the plugins registered so far.
        registerPlugin(ShellPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
