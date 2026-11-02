import AppKit
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let iconset = output.appendingPathComponent("Foundation.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let factor = CGFloat(pixels) / 1024
        let transform = NSAffineTransform()
        transform.scale(by: factor)
        transform.concat()
        let tile = NSBezierPath(roundedRect: NSRect(x: 52, y: 52, width: 920, height: 920), xRadius: 206, yRadius: 206)
        NSColor(calibratedRed: 0.12, green: 0.14, blue: 0.18, alpha: 1).setFill()
        tile.fill()
        NSColor(calibratedRed: 0.28, green: 0.31, blue: 0.37, alpha: 1).setStroke()
        tile.lineWidth = 3
        tile.stroke()
        NSColor(calibratedRed: 0.91, green: 0.94, blue: 0.99, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 275, y: 260, width: 116, height: 496), xRadius: 14, yRadius: 14).fill()
        NSBezierPath(roundedRect: NSRect(x: 275, y: 640, width: 474, height: 116), xRadius: 14, yRadius: 14).fill()
        NSColor(calibratedRed: 0.49, green: 0.63, blue: 1, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 425, y: 457, width: 254, height: 106), xRadius: 12, yRadius: 12).fill()
        image.unlockFocus()
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", output.appendingPathComponent("Foundation.icns").path]
try task.run()
task.waitUntilExit()
if task.terminationStatus != 0 { exit(task.terminationStatus) }
