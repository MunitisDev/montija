/**
 * Adapter between the renderer-agnostic {@link CameraController} and a real
 * Phaser camera.
 *
 * The controller is the source of truth; this class only copies its state
 * across each frame and keeps the controller informed of the viewport size.
 * Nothing else in the codebase should move `cameras.main` directly.
 */

import type Phaser from 'phaser';
import type { CameraController } from '@/renderer/camera/CameraController';

export class PhaserCameraBinding {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly controller: CameraController;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, controller: CameraController) {
    this.camera = camera;
    this.controller = controller;
    this.syncViewport();
  }

  /** Pushes the controller's current view onto the Phaser camera. */
  public sync(): void {
    const view = this.controller.view;
    this.camera.setZoom(view.zoom);
    this.camera.centerOn(view.centreX, view.centreY);
  }

  /** Tells the controller how large the viewport is, after a resize. */
  public syncViewport(): void {
    this.controller.setViewportSize({
      width: this.camera.width,
      height: this.camera.height,
    });
  }
}
