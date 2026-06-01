"use client";

import { cn } from "@/lib/utils";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, RotateCcw } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

export type ScanResultStatus = "idle" | "success" | "error";

export interface QrScannerProps {
	onScan: (lotId: string) => void;
	active?: boolean;
	className?: string;
}

function playSuccessBeep(): void {
	try {
		const ctx = new AudioContext();
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();

		oscillator.connect(gain);
		gain.connect(ctx.destination);

		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(880, ctx.currentTime);
		gain.gain.setValueAtTime(0.4, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

		oscillator.start(ctx.currentTime);
		oscillator.stop(ctx.currentTime + 0.3);

		oscillator.onended = () => ctx.close();
	} catch {
		// Web Audio API not available — silently ignore
	}
}

function playErrorAlert(): void {
	try {
		const ctx = new AudioContext();

		const playTone = (freq: number, startTime: number, duration: number) => {
			const oscillator = ctx.createOscillator();
			const gain = ctx.createGain();

			oscillator.connect(gain);
			gain.connect(ctx.destination);

			oscillator.type = "square";
			oscillator.frequency.setValueAtTime(freq, startTime);
			gain.gain.setValueAtTime(0.3, startTime);
			gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

			oscillator.start(startTime);
			oscillator.stop(startTime + duration);
		};

		playTone(440, ctx.currentTime, 0.2);
		playTone(330, ctx.currentTime + 0.22, 0.2);

		setTimeout(() => ctx.close(), 600);
	} catch {
		// Web Audio API not available — silently ignore
	}
}

export interface QrScannerHandle {
	reportResult: (success: boolean, errorMessage?: string) => void;
	retryCamera: () => void;
}

const QrScanner = React.forwardRef<QrScannerHandle, QrScannerProps>(
	function QrScanner({ onScan, active = true, className }, ref) {
		const scannerRef = useRef<Html5Qrcode | null>(null);
		const cameraRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
			null,
		);
		const isStartingCameraRef = useRef(false);
		const startCameraRef = useRef<() => void>(() => {});
		const onScanRef = useRef(onScan);
		const hasMultipleCamerasRef = useRef(false);
		const scanningRef = useRef(false);

		useEffect(() => {
			onScanRef.current = onScan;
		}, [onScan]);

		const [cameraError, setCameraError] = useState<string | null>(null);
		const [cameraInitialized, setCameraInitialized] = useState(false);
		const [facingMode, setFacingMode] = useState<"environment" | "user">(
			"environment",
		);
		const [isFlipping, setIsFlipping] = useState(false);
		const [showFlipButton, setShowFlipButton] = useState(false);

		React.useImperativeHandle(
			ref,
			() => ({
				reportResult(success: boolean, errorMessage?: string) {
					if (success) {
						playSuccessBeep();
					} else {
						playErrorAlert();
					}
				},
				retryCamera() {
					setCameraError(null);
					isStartingCameraRef.current = false;
					startCameraRef.current();
				},
			}),
			[],
		);

		const stopCamera = useCallback(async () => {
			if (cameraRetryTimeoutRef.current) {
				clearTimeout(cameraRetryTimeoutRef.current);
				cameraRetryTimeoutRef.current = null;
			}
			scanningRef.current = false;
			isStartingCameraRef.current = false;
			setCameraInitialized(false);
			if (scannerRef.current) {
				try {
					await scannerRef.current.stop();
				} catch {
					// ignore cleanup errors
				}
				scannerRef.current = null;
			}
		}, []);

		const startCamera = useCallback(async () => {
			startCameraRef.current = startCamera;

			if (isStartingCameraRef.current) return;
			if (cameraInitialized) return;

			isStartingCameraRef.current = true;
			setCameraError(null);

			try {
				const scanner = new Html5Qrcode("qr-reader");
				scannerRef.current = scanner;

				const cameras = await Html5Qrcode.getCameras();
				hasMultipleCamerasRef.current = cameras.length > 1;
				setShowFlipButton(cameras.length > 1);

				await scanner.start(
					{ facingMode },
					{ fps: 10, qrbox: { width: 250, height: 250 } },
					(decodedText) => {
						if (scanningRef.current) return;

						const trimmed = decodedText?.trim();
						if (!trimmed) return;

						scanningRef.current = true;
						onScanRef.current(trimmed);
					},
					() => {
						// Scan failure - ignore, keep scanning
					},
				);

				setCameraInitialized(true);
				isStartingCameraRef.current = false;
			} catch (err) {
				isStartingCameraRef.current = false;
				const errStr = err instanceof Error ? err.message : String(err);

				if (
					errStr.includes("CamerasNotAuthorizedError") ||
					errStr.includes("Permission denied")
				) {
					setCameraError(
						"Camera permission denied. Please allow camera access in your browser settings.",
					);
					return;
				}

				if (
					errStr.includes("NotFoundException") ||
					errStr.includes("No camera found")
				) {
					setCameraError("No camera found on this device.");
					return;
				}

				if (
					errStr.includes("NotReadableError") ||
					errStr.includes("camera in use")
				) {
					const retryDelay = 2000;
					cameraRetryTimeoutRef.current = setTimeout(() => {
						isStartingCameraRef.current = false;
						startCameraRef.current();
					}, retryDelay);
					return;
				}

				const message =
					err instanceof Error ? err.message : "Camera access denied";
				setCameraError(message);
			}
		}, [cameraInitialized, facingMode]);

		const flipCamera = useCallback(async () => {
			if (isFlipping || !scannerRef.current) return;

			setIsFlipping(true);
			try {
				await scannerRef.current.stop();
				setFacingMode((prev) =>
					prev === "environment" ? "user" : "environment",
				);
			} catch {
				// ignore
			}
			setIsFlipping(false);
		}, [isFlipping]);

		useEffect(() => {
			let mounted = true;

			const initCamera = async () => {
				if (!mounted) return;
				if (active) {
					await startCamera();
				} else {
					await stopCamera();
				}
			};

			initCamera();

			return () => {
				mounted = false;
				stopCamera();
			};
		}, [active]);

		useEffect(() => {
			if (cameraInitialized && scannerRef.current) {
				stopCamera().then(() => {
					startCamera();
				});
			}
		}, [facingMode]);

		return (
			<div
				className={cn(
					"relative w-full max-w-md aspect-square overflow-hidden rounded-xl bg-black",
					className,
				)}
				aria-label="QR code scanner"
				role="region">
				<div
					id="qr-reader"
					className="w-full h-full"
				/>

				{/* <div
					aria-hidden="true"
					className="absolute inset-[15%] border-[3px] border-white/70 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none z-20"
				/> */}

				{showFlipButton && !cameraError && (
					<button
						onClick={flipCamera}
						disabled={isFlipping}
						aria-label="Flip camera"
						className={cn(
							"absolute top-3 right-3 z-30 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors",
							isFlipping && "opacity-50 cursor-not-allowed",
						)}>
						<RotateCcw className="size-5" />
					</button>
				)}

				{cameraError && (
					<div
						role="alert"
						className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-6 text-center gap-2">
						<Camera className="size-12 text-red-500" />
						<span className="font-semibold">Camera unavailable</span>
						<span className="text-sm opacity-80">{cameraError}</span>
						<button
							onClick={() => {
								setCameraError(null);
								isStartingCameraRef.current = false;
								startCameraRef.current();
							}}
							className="mt-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg font-medium">
							Retry
						</button>
					</div>
				)}
			</div>
		);
	},
);

QrScanner.displayName = "QrScanner";

export default QrScanner;
export { QrScanner };
