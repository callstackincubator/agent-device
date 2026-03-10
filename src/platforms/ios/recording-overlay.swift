import AppKit
import AVFoundation
import Foundation
import QuartzCore

struct GestureEnvelope: Decodable {
  let events: [GestureEvent]
}

struct GestureEvent: Decodable {
  let kind: String
  let tMs: Double
  let x: Double
  let y: Double
  let x2: Double?
  let y2: Double?
  let durationMs: Double?
  let scale: Double?
}

enum OverlayError: Error, CustomStringConvertible {
  case invalidArgs(String)
  case missingVideoTrack
  case exportFailed(String)

  var description: String {
    switch self {
    case .invalidArgs(let message):
      return message
    case .missingVideoTrack:
      return "Input video does not contain a video track."
    case .exportFailed(let message):
      return message
    }
  }
}

do {
  try run()
} catch {
  fputs("recording-overlay: \(error)\n", stderr)
  exit(1)
}

func run() throws {
  let arguments = Array(CommandLine.arguments.dropFirst())
  let parsedArgs = try parseArguments(arguments)
  let inputURL = URL(fileURLWithPath: parsedArgs.inputPath)
  let outputURL = URL(fileURLWithPath: parsedArgs.outputPath)
  let eventsURL = URL(fileURLWithPath: parsedArgs.eventsPath)

  if FileManager.default.fileExists(atPath: outputURL.path) {
    try FileManager.default.removeItem(at: outputURL)
  }

  let payload = try Data(contentsOf: eventsURL)
  let envelope = try JSONDecoder().decode(GestureEnvelope.self, from: payload)

  if envelope.events.isEmpty {
    try FileManager.default.copyItem(at: inputURL, to: outputURL)
    return
  }

  let asset = AVURLAsset(url: inputURL)
  guard let sourceVideoTrack = asset.tracks(withMediaType: .video).first else {
    throw OverlayError.missingVideoTrack
  }

  let composition = AVMutableComposition()
  guard let compositionVideoTrack = composition.addMutableTrack(
    withMediaType: .video,
    preferredTrackID: kCMPersistentTrackID_Invalid
  ) else {
    throw OverlayError.exportFailed("Failed to create composition video track.")
  }

  let fullRange = CMTimeRange(start: .zero, duration: asset.duration)
  try compositionVideoTrack.insertTimeRange(fullRange, of: sourceVideoTrack, at: .zero)

  if let sourceAudioTrack = asset.tracks(withMediaType: .audio).first,
     let compositionAudioTrack = composition.addMutableTrack(
       withMediaType: .audio,
       preferredTrackID: kCMPersistentTrackID_Invalid
     ) {
    try? compositionAudioTrack.insertTimeRange(fullRange, of: sourceAudioTrack, at: .zero)
  }

  let renderSize = resolvedRenderSize(for: sourceVideoTrack)
  let videoComposition = AVMutableVideoComposition()
  videoComposition.renderSize = renderSize
  videoComposition.frameDuration = CMTime(value: 1, timescale: 60)

  let instruction = AVMutableVideoCompositionInstruction()
  instruction.timeRange = fullRange
  let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)
  layerInstruction.setTransform(sourceVideoTrack.preferredTransform, at: .zero)
  instruction.layerInstructions = [layerInstruction]
  videoComposition.instructions = [instruction]

  let parentLayer = CALayer()
  parentLayer.frame = CGRect(origin: .zero, size: renderSize)
  parentLayer.masksToBounds = true

  let videoLayer = CALayer()
  videoLayer.frame = parentLayer.frame
  parentLayer.addSublayer(videoLayer)

  let overlayLayer = CALayer()
  overlayLayer.frame = parentLayer.frame
  parentLayer.addSublayer(overlayLayer)

  for event in envelope.events {
    switch event.kind {
    case "tap":
      addTapLayer(event: event, to: overlayLayer)
    case "longpress":
      addLongPressLayer(event: event, to: overlayLayer)
    case "swipe":
      addSwipeLayers(event: event, to: overlayLayer)
    case "pinch":
      addPinchLayers(event: event, to: overlayLayer)
    default:
      continue
    }
  }

  videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
    postProcessingAsVideoLayer: videoLayer,
    in: parentLayer
  )

  guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
    throw OverlayError.exportFailed("Failed to create export session.")
  }

  exporter.outputURL = outputURL
  exporter.outputFileType = .mp4
  exporter.videoComposition = videoComposition
  exporter.shouldOptimizeForNetworkUse = true

  let semaphore = DispatchSemaphore(value: 0)
  exporter.exportAsynchronously {
    semaphore.signal()
  }
  _ = semaphore.wait(timeout: .now() + 120)

  if exporter.status != .completed {
    throw OverlayError.exportFailed(exporter.error?.localizedDescription ?? "Touch overlay export failed.")
  }
}

func parseArguments(_ arguments: [String]) throws -> (inputPath: String, outputPath: String, eventsPath: String) {
  var inputPath: String?
  var outputPath: String?
  var eventsPath: String?
  var index = 0

  while index < arguments.count {
    let argument = arguments[index]
    let nextIndex = index + 1
    switch argument {
    case "--input":
      guard nextIndex < arguments.count else { throw OverlayError.invalidArgs("--input requires a value") }
      inputPath = arguments[nextIndex]
      index += 2
    case "--output":
      guard nextIndex < arguments.count else { throw OverlayError.invalidArgs("--output requires a value") }
      outputPath = arguments[nextIndex]
      index += 2
    case "--events":
      guard nextIndex < arguments.count else { throw OverlayError.invalidArgs("--events requires a value") }
      eventsPath = arguments[nextIndex]
      index += 2
    default:
      throw OverlayError.invalidArgs("Unknown argument: \(argument)")
    }
  }

  guard let inputPath, let outputPath, let eventsPath else {
    throw OverlayError.invalidArgs("Usage: recording-overlay.swift --input <video> --output <video> --events <json>")
  }
  return (inputPath, outputPath, eventsPath)
}

func resolvedRenderSize(for track: AVAssetTrack) -> CGSize {
  let transformed = track.naturalSize.applying(track.preferredTransform)
  return CGSize(width: abs(transformed.width), height: abs(transformed.height))
}

func addTapLayer(event: GestureEvent, to overlayLayer: CALayer) {
  let layer = makeTouchDotLayer(center: CGPoint(x: event.x, y: event.y), radius: 26)
  overlayLayer.addSublayer(layer)

  let opacity = CAKeyframeAnimation(keyPath: "opacity")
  opacity.values = [0.0, 0.95, 0.2, 0.0]
  opacity.keyTimes = [0.0, 0.2, 0.8, 1.0]

  let scale = CAKeyframeAnimation(keyPath: "transform.scale")
  scale.values = [0.5, 1.0, 1.18]
  scale.keyTimes = [0.0, 0.4, 1.0]

  let group = CAAnimationGroup()
  group.animations = [opacity, scale]
  group.duration = 0.32
  group.beginTime = AVCoreAnimationBeginTimeAtZero + (event.tMs / 1000.0)
  group.fillMode = .both
  group.isRemovedOnCompletion = false
  layer.add(group, forKey: "tap")
}

func addLongPressLayer(event: GestureEvent, to overlayLayer: CALayer) {
  let duration = max(0.45, (event.durationMs ?? 800) / 1000.0)
  let layer = makeTouchDotLayer(center: CGPoint(x: event.x, y: event.y), radius: 28)
  overlayLayer.addSublayer(layer)

  let opacity = CAKeyframeAnimation(keyPath: "opacity")
  opacity.values = [0.0, 1.0, 1.0, 0.0]
  opacity.keyTimes = [0.0, 0.08, 0.92, 1.0]

  let scale = CAKeyframeAnimation(keyPath: "transform.scale")
  scale.values = [0.7, 1.0, 1.05]
  scale.keyTimes = [0.0, 0.15, 1.0]

  let group = CAAnimationGroup()
  group.animations = [opacity, scale]
  group.duration = duration
  group.beginTime = AVCoreAnimationBeginTimeAtZero + (event.tMs / 1000.0)
  group.fillMode = .both
  group.isRemovedOnCompletion = false
  layer.add(group, forKey: "longpress")
}

func addSwipeLayers(event: GestureEvent, to overlayLayer: CALayer) {
  guard let x2 = event.x2, let y2 = event.y2 else { return }
  let startPoint = CGPoint(x: event.x, y: event.y)
  let endPoint = CGPoint(x: x2, y: y2)
  let duration = max(0.1, (event.durationMs ?? 250) / 1000.0)
  let beginTime = AVCoreAnimationBeginTimeAtZero + (event.tMs / 1000.0)

  let pathLayer = CAShapeLayer()
  pathLayer.frame = overlayLayer.bounds
  pathLayer.path = {
    let path = CGMutablePath()
    path.move(to: startPoint)
    path.addLine(to: endPoint)
    return path
  }()
  pathLayer.strokeColor = NSColor(calibratedRed: 0.34, green: 0.76, blue: 1.0, alpha: 0.95).cgColor
  pathLayer.lineWidth = 8
  pathLayer.lineCap = .round
  pathLayer.fillColor = nil
  pathLayer.opacity = 0
  overlayLayer.addSublayer(pathLayer)

  let stroke = CABasicAnimation(keyPath: "strokeEnd")
  stroke.fromValue = 0.0
  stroke.toValue = 1.0

  let strokeOpacity = CAKeyframeAnimation(keyPath: "opacity")
  strokeOpacity.values = [0.0, 0.9, 0.5, 0.0]
  strokeOpacity.keyTimes = [0.0, 0.1, 0.85, 1.0]

  let strokeGroup = CAAnimationGroup()
  strokeGroup.animations = [stroke, strokeOpacity]
  strokeGroup.duration = duration + 0.18
  strokeGroup.beginTime = beginTime
  strokeGroup.fillMode = .both
  strokeGroup.isRemovedOnCompletion = false
  pathLayer.add(strokeGroup, forKey: "stroke")

  let dotLayer = makeTouchDotLayer(center: startPoint, radius: 24)
  overlayLayer.addSublayer(dotLayer)

  let position = CABasicAnimation(keyPath: "position")
  position.fromValue = NSValue(point: startPoint)
  position.toValue = NSValue(point: endPoint)
  position.duration = duration

  let opacity = CAKeyframeAnimation(keyPath: "opacity")
  opacity.values = [0.0, 1.0, 1.0, 0.0]
  opacity.keyTimes = [0.0, 0.08, 0.92, 1.0]

  let group = CAAnimationGroup()
  group.animations = [position, opacity]
  group.duration = duration
  group.beginTime = beginTime
  group.fillMode = .both
  group.isRemovedOnCompletion = false
  dotLayer.add(group, forKey: "swipe-dot")
}

func addPinchLayers(event: GestureEvent, to overlayLayer: CALayer) {
  let duration = max(0.18, (event.durationMs ?? 280) / 1000.0)
  let beginTime = AVCoreAnimationBeginTimeAtZero + (event.tMs / 1000.0)
  let startOffset: CGFloat = 28
  let scale = max(0.2, min(event.scale ?? 1.0, 3.0))
  let endOffset = scale >= 1.0 ? startOffset * CGFloat(min(scale, 2.0)) : startOffset * CGFloat(max(scale, 0.5))
  let startLeft = CGPoint(x: event.x - Double(startOffset), y: event.y)
  let startRight = CGPoint(x: event.x + Double(startOffset), y: event.y)
  let endLeft = CGPoint(x: event.x - Double(endOffset), y: event.y)
  let endRight = CGPoint(x: event.x + Double(endOffset), y: event.y)

  addPinchDot(
    overlayLayer: overlayLayer,
    start: startLeft,
    end: endLeft,
    beginTime: beginTime,
    duration: duration
  )
  addPinchDot(
    overlayLayer: overlayLayer,
    start: startRight,
    end: endRight,
    beginTime: beginTime,
    duration: duration
  )
}

func addPinchDot(
  overlayLayer: CALayer,
  start: CGPoint,
  end: CGPoint,
  beginTime: CFTimeInterval,
  duration: CFTimeInterval
) {
  let dotLayer = makeTouchDotLayer(center: start, radius: 20)
  overlayLayer.addSublayer(dotLayer)

  let position = CABasicAnimation(keyPath: "position")
  position.fromValue = NSValue(point: start)
  position.toValue = NSValue(point: end)
  position.duration = duration

  let opacity = CAKeyframeAnimation(keyPath: "opacity")
  opacity.values = [0.0, 1.0, 1.0, 0.0]
  opacity.keyTimes = [0.0, 0.12, 0.88, 1.0]

  let group = CAAnimationGroup()
  group.animations = [position, opacity]
  group.duration = duration
  group.beginTime = beginTime
  group.fillMode = .both
  group.isRemovedOnCompletion = false
  dotLayer.add(group, forKey: "pinch")
}

func makeTouchDotLayer(center: CGPoint, radius: CGFloat) -> CALayer {
  let layer = CALayer()
  layer.bounds = CGRect(x: 0, y: 0, width: radius * 2, height: radius * 2)
  layer.position = center
  layer.cornerRadius = radius
  layer.backgroundColor = NSColor(calibratedRed: 0.09, green: 0.15, blue: 0.22, alpha: 0.28).cgColor
  layer.borderWidth = 5
  layer.borderColor = NSColor(calibratedRed: 0.99, green: 0.99, blue: 1.0, alpha: 0.95).cgColor
  layer.shadowColor = NSColor.black.cgColor
  layer.shadowOpacity = 0.16
  layer.shadowRadius = 10
  layer.opacity = 0
  return layer
}
