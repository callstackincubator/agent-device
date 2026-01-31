// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "axsnapshot",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "axsnapshot", targets: ["AXSnapshot"])
    ],
    targets: [
        .executableTarget(
            name: "AXSnapshot",
            path: "Sources/AXSnapshot"
        )
    ]
)
