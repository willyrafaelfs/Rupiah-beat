# Rupiah Beat

![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)
![License](https://img.shields.io/badge/License-MIT-blue)

A playful audio-reactive web app that turns music into a live "currency chart". Play a track or upload your own, and watch a Google-style price line and spectrum visualizer pulse in real time to the beat. The displayed Rupiah value and IDR/USD conversion react to the bass — it's a fun simulation, not real market data.

## Features

- 🎧 **Audio-reactive engine** — Web Audio API analyser extracts bass energy from any playing or uploaded track.
- 📈 **Live price chart** — smooth Bezier line drawn frame-by-frame on a pure HTML5 Canvas, with dynamic red (up) / green (down) trend coloring.
- 🌈 **Spectrum visualizer & ticker** — frequency bars and a glowing Rupiah ticker that flash on every change.
- 💱 **IDR ⇄ USD converter** — two-way currency inputs with a swap button, kept in sync with the live chart value. The header ticker automatically multiplies by the USD amount entered.
- 🎵 **Built-in default track** — a bundled MP3 is auto-loaded on page open so you can hit play immediately.
- ⏩ **Progress bar & seek** — drag the slider to jump to any position in the track, with live time/duration display.

## Tech Stack

- HTML5 Canvas 2D
- Web Audio API
- Vanilla JavaScript
- Vercel

## Live Demo

[Live Demo](https://rupiah-beat.vercel.app/)

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/willyrafaelfs/Rupiah-beat.git
   cd Rupiah-beat
   ```
2. Open `index.html` directly in your browser — no build step required.
3. Or deploy to [Vercel](https://vercel.com) for a hosted version (point it at this repo and deploy the static files as-is).

> **Disclaimer:** All prices are a simulation driven by audio — not real financial data.
