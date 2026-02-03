import Foundation
import Capacitor

@objc(WebDavHttpPlugin)
public class WebDavHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebDavHttpPlugin"
    public let jsName = "WebDavHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config)
    }()

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("URL is required")
            return
        }

        let method = call.getString("method") ?? "GET"
        let headers = call.getObject("headers") as? [String: String] ?? [:]
        let data = call.getString("data")

        var request = URLRequest(url: url)
        request.httpMethod = method

        for (key, value) in headers {
            if key.lowercased() != "content-length" {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }

        if let data = data, !data.isEmpty {
            request.httpBody = data.data(using: .utf8)
        } else if methodRequiresBody(method) {
            request.httpBody = Data()
        }

        let task = session.dataTask(with: request) { responseData, response, error in
            if let error = error {
                let nsError = error as NSError
                switch nsError.code {
                case NSURLErrorNotConnectedToInternet,
                     NSURLErrorNetworkConnectionLost,
                     NSURLErrorCannotFindHost,
                     NSURLErrorCannotConnectToHost,
                     NSURLErrorDNSLookupFailed:
                    call.reject("Network error: \(error.localizedDescription)", "NETWORK_ERROR", error)
                case NSURLErrorTimedOut:
                    call.reject("Network error: Request timeout", "TIMEOUT_ERROR", error)
                case NSURLErrorSecureConnectionFailed,
                     NSURLErrorServerCertificateHasBadDate,
                     NSURLErrorServerCertificateUntrusted,
                     NSURLErrorServerCertificateHasUnknownRoot,
                     NSURLErrorServerCertificateNotYetValid:
                    call.reject("SSL error: \(error.localizedDescription)", "SSL_ERROR", error)
                default:
                    call.reject("Network error: \(error.localizedDescription)", "NETWORK_ERROR", error)
                }
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                call.reject("Invalid response", "INVALID_RESPONSE")
                return
            }

            let responseHeaders = JSObject()
            for (key, value) in httpResponse.allHeaderFields {
                if let keyStr = key as? String, let valueStr = value as? String {
                    responseHeaders[keyStr.lowercased()] = valueStr
                }
            }

            let bodyString: String
            if let responseData = responseData, !responseData.isEmpty {
                guard let decoded = String(data: responseData, encoding: .utf8) else {
                    call.reject("Failed to decode response as UTF-8 (\(responseData.count) bytes)", "DECODE_ERROR")
                    return
                }
                bodyString = decoded
            } else {
                bodyString = ""
            }

            var result = JSObject()
            result["data"] = bodyString
            result["status"] = httpResponse.statusCode
            result["headers"] = responseHeaders
            result["url"] = httpResponse.url?.absoluteString ?? urlString

            call.resolve(result)
        }
        task.resume()
    }

    private func methodRequiresBody(_ method: String) -> Bool {
        let upper = method.uppercased()
        return ["POST", "PUT", "PATCH", "PROPFIND", "PROPPATCH", "REPORT", "LOCK"].contains(upper)
    }
}
