import UIKit
import Capacitor

class CustomViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebDavHttpPlugin())
    }
}
