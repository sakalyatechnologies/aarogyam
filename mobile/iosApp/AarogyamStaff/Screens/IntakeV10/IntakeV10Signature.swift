import PencilKit
import SwiftUI

/// A white pad to sign on, with a finger or pencil. Reports the PNG (nil when empty) after each stroke.
struct IntakeSignaturePad: UIViewRepresentable {
    let clearToken: Int
    let onChange: (Data?) -> Void

    func makeUIView(context: Context) -> PKCanvasView {
        let v = PKCanvasView()
        v.drawingPolicy = .anyInput
        v.overrideUserInterfaceStyle = .light
        v.backgroundColor = .white
        v.isOpaque = true
        v.tool = PKInkingTool(.pen, color: .black, width: 3)
        v.delegate = context.coordinator
        v.layer.cornerRadius = 12
        v.clipsToBounds = true
        v.isAccessibilityElement = true
        v.accessibilityLabel = iv("iv.sign.a11y")
        return v
    }

    func updateUIView(_ v: PKCanvasView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.lastClear != clearToken {
            context.coordinator.lastClear = clearToken
            v.drawing = PKDrawing()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: IntakeSignaturePad
        var lastClear: Int
        init(_ parent: IntakeSignaturePad) { self.parent = parent; lastClear = parent.clearToken }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            let png = IntakeV10Logic.signaturePNG(canvasView.drawing, size: canvasView.bounds.size)
            parent.onChange(png)
        }
    }
}
