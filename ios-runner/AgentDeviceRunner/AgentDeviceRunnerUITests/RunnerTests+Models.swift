// MARK: - Wire Models

enum CommandType: String, Codable {
  case tap
  case mouseClick
  case tapSeries
  case longPress
  case interactionFrame
  case drag
  case dragSeries
  case remotePress
  case type
  case swipe
  case findText
  case querySelector
  case readText
  case snapshot
  case screenshot
  case back
  case backInApp
  case backSystem
  case home
  case rotate
  case appSwitcher
  case keyboardDismiss
  case keyboardReturn
  case alert
  case pinch
  case rotateGesture
  case transformGesture
  case recordStart
  case recordStop
  case uptime
  case shutdown
}

struct Command: Codable {
  let command: CommandType
  let appBundleId: String?
  let text: String?
  let selectorKey: String?
  let selectorValue: String?
  let allowNonHittableCoordinateFallback: Bool?
  let delayMs: Int?
  let textEntryMode: String?
  let clearFirst: Bool?
  let action: String?
  let x: Double?
  let y: Double?
  let button: String?
  let remoteButton: String?
  let count: Double?
  let intervalMs: Double?
  let doubleTap: Bool?
  let pauseMs: Double?
  let pattern: String?
  let x2: Double?
  let y2: Double?
  let dx: Double?
  let dy: Double?
  let durationMs: Double?
  let direction: String?
  let orientation: String?
  let scale: Double?
  let degrees: Double?
  let velocity: Double?
  let outPath: String?
  let fps: Int?
  let quality: Int?
  let interactiveOnly: Bool?
  let compact: Bool?
  let depth: Int?
  let scope: String?
  let raw: Bool?
  let fullscreen: Bool?
}

struct Response: Codable {
  let ok: Bool
  let data: DataPayload?
  let error: ErrorPayload?

  init(ok: Bool, data: DataPayload? = nil, error: ErrorPayload? = nil) {
    self.ok = ok
    self.data = data
    self.error = error
  }
}

struct DataPayload: Codable {
  let message: String?
  let text: String?
  let found: Bool?
  let items: [String]?
  let nodes: [SnapshotNode]?
  let truncated: Bool?
  let gestureStartUptimeMs: Double?
  let gestureEndUptimeMs: Double?
  let x: Double?
  let y: Double?
  let x2: Double?
  let y2: Double?
  let referenceWidth: Double?
  let referenceHeight: Double?
  let currentUptimeMs: Double?
  let visible: Bool?
  let wasVisible: Bool?
  let dismissed: Bool?
  let orientation: String?

  init(
    message: String? = nil,
    text: String? = nil,
    found: Bool? = nil,
    items: [String]? = nil,
    nodes: [SnapshotNode]? = nil,
    truncated: Bool? = nil,
    gestureStartUptimeMs: Double? = nil,
    gestureEndUptimeMs: Double? = nil,
    x: Double? = nil,
    y: Double? = nil,
    x2: Double? = nil,
    y2: Double? = nil,
    referenceWidth: Double? = nil,
    referenceHeight: Double? = nil,
    currentUptimeMs: Double? = nil,
    visible: Bool? = nil,
    wasVisible: Bool? = nil,
    dismissed: Bool? = nil,
    orientation: String? = nil
  ) {
    self.message = message
    self.text = text
    self.found = found
    self.items = items
    self.nodes = nodes
    self.truncated = truncated
    self.gestureStartUptimeMs = gestureStartUptimeMs
    self.gestureEndUptimeMs = gestureEndUptimeMs
    self.x = x
    self.y = y
    self.x2 = x2
    self.y2 = y2
    self.referenceWidth = referenceWidth
    self.referenceHeight = referenceHeight
    self.currentUptimeMs = currentUptimeMs
    self.visible = visible
    self.wasVisible = wasVisible
    self.dismissed = dismissed
    self.orientation = orientation
  }
}

struct ErrorPayload: Codable {
  let code: String?
  let message: String

  init(code: String? = nil, message: String) {
    self.code = code
    self.message = message
  }
}

struct SnapshotRect: Codable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct SnapshotNode: Codable {
  let index: Int
  let type: String
  let label: String?
  let identifier: String?
  let value: String?
  let rect: SnapshotRect
  let enabled: Bool
  let focused: Bool?
  let selected: Bool?
  let hittable: Bool
  let depth: Int
  let parentIndex: Int?
  let hiddenContentAbove: Bool?
  let hiddenContentBelow: Bool?
}

struct SnapshotOptions {
  let interactiveOnly: Bool
  let compact: Bool
  let depth: Int?
  let scope: String?
  let raw: Bool
}
