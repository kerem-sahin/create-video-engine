// ink: photo -> the main subject cut out (Vision) -> ink line drawing on the brand's paper (Core Image), transparent PNG.
// Built and run by draw-from-photo.mjs on macOS 14+. Exit: 0 ok, 1 no subject found, 2 cannot run, 64 usage.
//   ink <in> <out.png> <width> <noise> <edge> <threshold> <lineRadius> <minSpeckArea> <flip 0|1> <inkHex> <paperHex>
import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision

func fail(_ m: String, _ code: Int32) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(code) }
let a = CommandLine.arguments
guard a.count == 12, let width = Double(a[3]), let noise = Float(a[4]), let edge = Float(a[5]), let thr = Float(a[6]),
      let lineR = Float(a[7]), let minArea = Int(a[8]) else { fail("usage: ink <in> <out.png> <width> <noise> <edge> <threshold> <lineRadius> <minSpeckArea> <flip> <inkHex> <paperHex>", 64) }
let flip = a[9] == "1"
func color(_ hex: String) -> CIColor {
  let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
  guard h.count == 6, let v = UInt32(h, radix: 16) else { fail("bad colour \(hex) (use #rrggbb)", 64) }
  return CIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255)
}
let inkC = color(a[10]), paperC = color(a[11])
guard let raw = CIImage(contentsOf: URL(fileURLWithPath: a[1]), options: [.applyOrientationProperty: true]) else { fail("cannot read \(a[1])", 2) }

// 1. work at the size it will be shown, so line weights are real pixels
let s = CGFloat(width) / raw.extent.width
var img = raw.transformed(by: CGAffineTransform(scaleX: s, y: s))
img = img.transformed(by: CGAffineTransform(translationX: -img.extent.minX, y: -img.extent.minY))
if flip { img = img.transformed(by: CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -img.extent.width, y: 0)) }
let box = CGRect(x: 0, y: 0, width: floor(img.extent.width), height: floor(img.extent.height))
img = img.cropped(to: box)
let ctx = CIContext()
let grey = CGColorSpaceCreateDeviceGray()

func area(_ m: CIImage) -> Int {
  let small = m.transformed(by: CGAffineTransform(scaleX: 0.25, y: 0.25))
  let w = Int(small.extent.width), h = Int(small.extent.height)
  var px = [UInt8](repeating: 0, count: w * h)
  ctx.render(small, toBitmap: &px, rowBytes: w, bounds: small.extent, format: .L8, colorSpace: grey)
  return px.reduce(0) { $0 + ($1 > 127 ? 1 : 0) }
}

// 2. the main subject only: the largest instance Vision finds (a person standing next to the car is left out)
let req = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: img)
do { try handler.perform([req]) } catch { fail("subject detection failed: \(error.localizedDescription)", 2) }
guard let obs = req.results?.first, !obs.allInstances.isEmpty else { fail("no subject found in the photo", 1) }
var best: (CIImage, Int)? = nil
for i in obs.allInstances {
  guard let buf = try? obs.generateScaledMaskForImage(forInstances: IndexSet(integer: i), from: handler) else { continue }
  let m = CIImage(cvPixelBuffer: buf).applyingFilter("CIColorThreshold", parameters: ["inputThreshold": 0.5]).cropped(to: box)
  let n = area(m)
  if best == nil || n > best!.1 { best = (m, n) }
}
guard let (mask, maskArea) = best, maskArea > 0 else { fail("no subject found in the photo", 1) }

// 3. ink lines from the subject on white
let white = CIImage(color: .white).cropped(to: box)
let cut = img.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: white, kCIInputMaskImageKey: mask])
let lo = CIFilter.lineOverlay()
lo.inputImage = cut; lo.nrNoiseLevel = noise; lo.nrSharpness = 0.71; lo.edgeIntensity = edge; lo.threshold = thr; lo.contrast = 50
let lineAlpha = lo.outputImage!.cropped(to: box).applyingFilter("CIColorMatrix", parameters: [
  "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 1), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 1), "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 1),
  "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 1)])
let fat = lineAlpha.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": lineR]).cropped(to: box)

// 4. drop specks (reflections, dust): connected ink blobs smaller than minArea pixels
func despeckle(_ m: CIImage) -> CIImage {
  let w = Int(box.width), h = Int(box.height)
  var px = [UInt8](repeating: 0, count: w * h)
  ctx.render(m, toBitmap: &px, rowBytes: w, bounds: box, format: .L8, colorSpace: grey)
  var seen = [Bool](repeating: false, count: w * h)
  var stack = [Int](), comp = [Int]()
  for start in 0..<(w * h) where px[start] > 127 && !seen[start] {
    stack.removeAll(keepingCapacity: true); comp.removeAll(keepingCapacity: true)
    stack.append(start); seen[start] = true
    while let i = stack.popLast() {
      comp.append(i)
      let x = i % w, y = i / w
      for dy in -1...1 { for dx in -1...1 {
        let nx = x + dx, ny = y + dy
        if (dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= w || ny >= h { continue }
        let j = ny * w + nx
        if px[j] > 127 && !seen[j] { seen[j] = true; stack.append(j) }
      } }
    }
    if comp.count < minArea { for i in comp { px[i] = 0 } }
  }
  let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w, space: grey, bitmapInfo: CGBitmapInfo(rawValue: 0),
                   provider: CGDataProvider(data: Data(px) as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
  return CIImage(cgImage: cg)
}
let lineMask = despeckle(fat).applyingFilter("CIMaskToAlpha")

// 5. outline the silhouette, fill it with paper, lines only inside
let dil = mask.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": 3]).cropped(to: box)
let ero = mask.applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": 1]).cropped(to: box)
let ring = ero.applyingFilter("CISubtractBlendMode", parameters: [kCIInputBackgroundImageKey: dil]).applyingFilter("CIMaskToAlpha")
let inside = mask.applyingFilter("CIMaskToAlpha")
func paint(_ c: CIColor, _ alpha: CIImage) -> CIImage {
  CIImage(color: c).cropped(to: box).applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: alpha])
}
let linesIn = paint(inkC, lineMask).applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: inside])
var out = paint(inkC, ring).composited(over: linesIn.composited(over: paint(paperC, inside))).cropped(to: box)

// 6. crop to the subject (plus the outline), so the PNG's size is the thing's size when it is placed
func bounds(_ m: CIImage) -> CGRect {
  let w = Int(box.width), h = Int(box.height)
  var px = [UInt8](repeating: 0, count: w * h)
  ctx.render(m, toBitmap: &px, rowBytes: w, bounds: box, format: .L8, colorSpace: grey)
  var x0 = w, y0 = h, x1 = -1, y1 = -1
  for y in 0..<h { for x in 0..<w where px[y * w + x] > 127 { x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y) } }
  if x1 < 0 { return box }
  // bitmap rows run top-down, Core Image's y runs bottom-up
  return CGRect(x: x0, y: h - 1 - y1, width: x1 - x0 + 1, height: y1 - y0 + 1).insetBy(dx: -6, dy: -6).intersection(box)
}
let sub = bounds(dil)
out = out.cropped(to: sub).transformed(by: CGAffineTransform(translationX: -sub.minX, y: -sub.minY))
let outBox = CGRect(x: 0, y: 0, width: sub.width, height: sub.height)
do {
  try ctx.writePNGRepresentation(of: out.cropped(to: outBox), to: URL(fileURLWithPath: a[2]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
} catch { fail("cannot write \(a[2]): \(error.localizedDescription)", 2) }
print("\(Int(outBox.width))x\(Int(outBox.height))")
