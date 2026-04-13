import AVFoundation
import Foundation

enum ResizeError: Error, CustomStringConvertible {
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
  fputs("recording-resize: \(error)\n", stderr)
  exit(1)
}

func run() throws {
  let arguments = Array(CommandLine.arguments.dropFirst())
  let parsedArgs = try parseArguments(arguments)
  let inputURL = URL(fileURLWithPath: parsedArgs.inputPath)
  let outputURL = URL(fileURLWithPath: parsedArgs.outputPath)

  if FileManager.default.fileExists(atPath: outputURL.path) {
    try FileManager.default.removeItem(at: outputURL)
  }

  let asset = AVURLAsset(url: inputURL)
  guard let sourceVideoTrack = asset.tracks(withMediaType: .video).first else {
    throw ResizeError.missingVideoTrack
  }

  let renderSize = scaledRenderSize(for: sourceVideoTrack, quality: parsedArgs.quality)
  let composition = AVMutableComposition()
  let fullRange = CMTimeRange(start: .zero, duration: asset.duration)

  guard let compositionVideoTrack = composition.addMutableTrack(
    withMediaType: .video,
    preferredTrackID: kCMPersistentTrackID_Invalid
  ) else {
    throw ResizeError.exportFailed("Failed to create composition video track.")
  }
  try compositionVideoTrack.insertTimeRange(fullRange, of: sourceVideoTrack, at: .zero)

  if let sourceAudioTrack = asset.tracks(withMediaType: .audio).first,
     let compositionAudioTrack = composition.addMutableTrack(
       withMediaType: .audio,
       preferredTrackID: kCMPersistentTrackID_Invalid
     ) {
    try? compositionAudioTrack.insertTimeRange(fullRange, of: sourceAudioTrack, at: .zero)
  }

  let scale = CGFloat(parsedArgs.quality) / 10.0
  let videoComposition = AVMutableVideoComposition()
  videoComposition.renderSize = renderSize
  videoComposition.frameDuration = resolvedFrameDuration(for: sourceVideoTrack)

  let instruction = AVMutableVideoCompositionInstruction()
  instruction.timeRange = fullRange
  let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionVideoTrack)
  // Keep rotation/translation from the source track, then scale into the smaller render canvas.
  let scaledTransform = sourceVideoTrack.preferredTransform.concatenating(
    CGAffineTransform(scaleX: scale, y: scale)
  )
  layerInstruction.setTransform(scaledTransform, at: .zero)
  instruction.layerInstructions = [layerInstruction]
  videoComposition.instructions = [instruction]

  guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
    throw ResizeError.exportFailed("Failed to create export session.")
  }

  exporter.outputURL = outputURL
  exporter.outputFileType = .mp4
  exporter.videoComposition = videoComposition
  exporter.shouldOptimizeForNetworkUse = true

  let semaphore = DispatchSemaphore(value: 0)
  exporter.exportAsynchronously {
    semaphore.signal()
  }
  if semaphore.wait(timeout: .now() + 120) == .timedOut {
    exporter.cancelExport()
    throw ResizeError.exportFailed("Resize export timed out.")
  }

  if exporter.status != .completed {
    throw ResizeError.exportFailed(exporter.error?.localizedDescription ?? "Resize export failed.")
  }
}

func parseArguments(_ arguments: [String]) throws -> (inputPath: String, outputPath: String, quality: Int) {
  var inputPath: String?
  var outputPath: String?
  var quality: Int?
  var index = 0

  while index < arguments.count {
    let argument = arguments[index]
    let nextIndex = index + 1
    switch argument {
    case "--input":
      guard nextIndex < arguments.count else { throw ResizeError.invalidArgs("--input requires a value") }
      inputPath = arguments[nextIndex]
      index += 2
    case "--output":
      guard nextIndex < arguments.count else { throw ResizeError.invalidArgs("--output requires a value") }
      outputPath = arguments[nextIndex]
      index += 2
    case "--quality":
      guard nextIndex < arguments.count else { throw ResizeError.invalidArgs("--quality requires a value") }
      guard let parsed = Int(arguments[nextIndex]), parsed >= 5, parsed <= 10 else {
        throw ResizeError.invalidArgs("--quality must be an integer between 5 and 10")
      }
      quality = parsed
      index += 2
    default:
      throw ResizeError.invalidArgs("Unknown argument: \(argument)")
    }
  }

  guard let inputPath, let outputPath, let quality else {
    throw ResizeError.invalidArgs(
      "Usage: recording-resize.swift --input <video> --output <video> --quality <5-10>"
    )
  }
  return (inputPath, outputPath, quality)
}

func resolvedRenderSize(for track: AVAssetTrack) -> CGSize {
  let transformed = track.naturalSize.applying(track.preferredTransform)
  return CGSize(width: abs(transformed.width), height: abs(transformed.height))
}

func scaledRenderSize(for track: AVAssetTrack, quality: Int) -> CGSize {
  let renderSize = resolvedRenderSize(for: track)
  guard quality < 10 else { return renderSize }
  let scale = CGFloat(quality) / 10.0
  return CGSize(
    width: scaledDimension(renderSize.width, scale: scale),
    height: scaledDimension(renderSize.height, scale: scale)
  )
}

func scaledDimension(_ value: CGFloat, scale: CGFloat) -> CGFloat {
  let evenValue = Int((Double(value * scale) / 2.0).rounded()) * 2
  return CGFloat(max(2, evenValue))
}

func resolvedFrameDuration(for track: AVAssetTrack) -> CMTime {
  let minFrameDuration = track.minFrameDuration
  if minFrameDuration.isValid && !minFrameDuration.isIndefinite && minFrameDuration.seconds > 0 {
    return minFrameDuration
  }

  let nominalFrameRate = track.nominalFrameRate
  if nominalFrameRate > 0 {
    let timescale = Int32(max(1, round(nominalFrameRate)))
    return CMTime(value: 1, timescale: timescale)
  }

  return CMTime(value: 1, timescale: 60)
}
