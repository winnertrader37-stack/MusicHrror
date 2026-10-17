"use strict";

/* =========================================================
   NAOL MUSIC STUDIO 3D
   Complete browser-based audio editor
   File: script.js
   ========================================================= */

(() => {
    "use strict";

    /* =====================================================
       1. HELPERS
       ===================================================== */

    const $ = (id) => document.getElementById(id);

    const $$ = (selector, root = document) =>
        Array.from(root.querySelectorAll(selector));

    const clamp = (value, min, max) =>
        Math.min(max, Math.max(min, value));

    const formatTime = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) {
            seconds = 0;
        }

        const minutes = Math.floor(seconds / 60);
        const remaining = Math.floor(seconds % 60);
        const hundredths = Math.floor((seconds % 1) * 100);

        return (
            String(minutes).padStart(2, "0") +
            ":" +
            String(remaining).padStart(2, "0") +
            "." +
            String(hundredths).padStart(2, "0")
        );
    };

    const formatBytes = (bytes) => {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return "0 B";
        }

        const units = ["B", "KB", "MB", "GB"];
        const index = Math.min(
            units.length - 1,
            Math.floor(Math.log(bytes) / Math.log(1024))
        );

        return (
            (bytes / Math.pow(1024, index)).toFixed(2) +
            " " +
            units[index]
        );
    };

    const midiToFrequency = (midi) =>
        440 * Math.pow(2, (midi - 69) / 12);

    const safeText = (element, text) => {
        if (element) {
            element.textContent = String(text);
        }
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = filename;

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setTimeout(() => URL.revokeObjectURL(url), 30000);
    };

    const showToast = (message, duration = 3000) => {
        const toast = $("toast");

        if (toast) {
            toast.textContent = message;
            toast.classList.add("show");
            toast.setAttribute("aria-live", "polite");

            clearTimeout(showToast.timer);

            showToast.timer = setTimeout(() => {
                toast.classList.remove("show");
            }, duration);
        } else {
            console.info("[Naol Music Studio]", message);
        }
    };

    const setStatus = (message) => {
        safeText($("engineStatus"), message);
        safeText($("engineFooterStatus"), message);
        safeText($("audioStatus"), message);
    };

    const setButtonEnabled = (id, enabled) => {
        const element = $(id);

        if (element) {
            element.disabled = !enabled;
        }
    };

    const readNumber = (id, fallback = 0) => {
        const element = $(id);

        if (!element) {
            return fallback;
        }

        const value = Number(element.value);

        return Number.isFinite(value) ? value : fallback;
    };

    const getAudioContextClass = () =>
        window.AudioContext || window.webkitAudioContext;

    /* =====================================================
       2. APPLICATION STATE
       ===================================================== */

    const state = {
        audioContext: null,
        masterGain: null,
        masterAnalyser: null,
        masterMuteGain: null,

        tracks: [],
        activeTrackId: null,
        nextTrackId: 1,

        playing: false,
        playStartContextTime: 0,
        playStartOffset: 0,
        playTimer: null,
        animationFrame: null,

        masterMuted: false,
        soloTrackId: null,

        zoom: 1,
        undoStack: [],
        redoStack: [],

        mediaRecorder: null,
        mediaStream: null,
        recordingChunks: [],
        recordingBlob: null,
        recordingUrl: null,
        recordingStartedAt: 0,
        recordingElapsedBeforePause: 0,
        recordingTimer: null,
        recordingPaused: false,

        keyboardRecordingEvents: [],
        keyboardRecordingStart: 0,
        keyboardRecordingPausedAt: 0,
        keyboardRecordingPauseTotal: 0,
        keyboardRecording: false,
        keyboardPaused: false,
        keyboardTimer: null,

        keyboardActiveNotes: new Map(),
        keyboardAudioBuffer: null,

        currentPreviewBuffer: null,
        currentPreviewSource: null,

        effectNodes: new Map(),
        sourceNodes: new Map(),

        exportBlob: null,
        exportUrl: null,

        comparing: false,
        beforeCompare: null,

        lastAnalysis: null,
        projectName: "Naol Music Studio 3D"
    };

    /* =====================================================
       3. AUDIO ENGINE
       ===================================================== */

    function ensureAudioContext() {
        const AudioContextClass = getAudioContextClass();

        if (!AudioContextClass) {
            showToast(
                "Browser kana Web Audio API hin deeggaru.",
                5000
            );

            return null;
        }

        if (!state.audioContext) {
            state.audioContext = new AudioContextClass();

            state.masterGain =
                state.audioContext.createGain();

            state.masterMuteGain =
                state.audioContext.createGain();

            state.masterAnalyser =
                state.audioContext.createAnalyser();

            state.masterAnalyser.fftSize = 2048;

            state.masterGain.gain.value = 1;
            state.masterMuteGain.gain.value = 1;

            state.masterGain.connect(state.masterMuteGain);
            state.masterMuteGain.connect(
                state.masterAnalyser
            );

            state.masterAnalyser.connect(
                state.audioContext.destination
            );

            updateMasterVolume();
            updateMasterMeter();
        }

        if (state.audioContext.state === "suspended") {
            state.audioContext.resume().catch((error) => {
                console.error("Audio resume failed:", error);
            });
        }

        return state.audioContext;
    }

    function makeTrackNodes(track) {
        const context = ensureAudioContext();

        if (!context || track.nodes) {
            return;
        }

        const input = context.createGain();
        const highpass = context.createBiquadFilter();
        const bass = context.createBiquadFilter();
        const mid = context.createBiquadFilter();
        const treble = context.createBiquadFilter();
        const distortion = context.createWaveShaper();
        const delay = context.createDelay(2);
        const delayFeedback = context.createGain();
        const delayWet = context.createGain();
        const reverb = context.createConvolver();
        const reverbWet = context.createGain();
        const dry = context.createGain();
        const pan = context.createStereoPanner();
        const volume = context.createGain();
        const analyser = context.createAnalyser();

        highpass.type = "highpass";
        highpass.frequency.value = 20;

        bass.type = "lowshelf";
        bass.frequency.value = 180;

        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 0.8;

        treble.type = "highshelf";
        treble.frequency.value = 5000;

        distortion.oversample = "4x";

        delay.delayTime.value = 0.18;
        delayFeedback.gain.value = 0.15;
        delayWet.gain.value = 0;

        reverbWet.gain.value = 0;
        dry.gain.value = 1;

        pan.pan.value = 0;
        volume.gain.value = track.volume;

        analyser.fftSize = 1024;

        const reverbLength = Math.floor(
            context.sampleRate * 1.5
        );

        const impulse = context.createBuffer(
            2,
            reverbLength,
            context.sampleRate
        );

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);

            for (let i = 0; i < reverbLength; i++) {
                const decay = Math.pow(
                    1 - i / reverbLength,
                    2.4
                );

                data[i] =
                    (Math.random() * 2 - 1) * decay;
            }
        }

        reverb.buffer = impulse;

        input.connect(highpass);
        highpass.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(distortion);

        distortion.connect(dry);
        dry.connect(volume);

        distortion.connect(delay);
        delay.connect(delayFeedback);
        delayFeedback.connect(delay);
        delay.connect(delayWet);
        delayWet.connect(volume);

        distortion.connect(reverb);
        reverb.connect(reverbWet);
        reverbWet.connect(volume);

        volume.connect(pan);
        pan.connect(analyser);

        track.nodes = {
            input,
            highpass,
            bass,
            mid,
            treble,
            distortion,
            delay,
            delayFeedback,
            delayWet,
            reverb,
            reverbWet,
            dry,
            pan,
            volume,
            analyser
        };

        applyTrackEffects(track);
    }

    function makeDistortionCurve(amount) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const k = Math.max(0, amount) * 8;

        if (k === 0) {
            for (let i = 0; i < samples; i++) {
                curve[i] = (i * 2) / samples - 1;
            }

            return curve;
        }

        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;

            curve[i] =
                ((3 + k) * x * 20 * Math.PI / 180) /
                (Math.PI + k * Math.abs(x));
        }

        return curve;
    }

    function applyTrackEffects(track) {
        if (!track || !track.nodes || !state.audioContext) {
            return;
        }

        const nodes = track.nodes;
        const now = state.audioContext.currentTime;

        nodes.volume.gain.setTargetAtTime(
            track.muted ? 0 : track.volume,
            now,
            0.015
        );

        nodes.pan.pan.setTargetAtTime(
            clamp(track.pan, -1, 1),
            now,
            0.015
        );

        nodes.bass.gain.setTargetAtTime(
            track.bass,
            now,
            0.015
        );

        nodes.mid.gain.setTargetAtTime(
            track.mid,
            now,
            0.015
        );

        nodes.treble.gain.setTargetAtTime(
            track.treble,
            now,
            0.015
        );

        nodes.delayWet.gain.setTargetAtTime(
            track.delay / 100 * 0.5,
            now,
            0.015
        );

        nodes.delayFeedback.gain.setTargetAtTime(
            clamp(track.delay / 100 * 0.65, 0, 0.65),
            now,
            0.015
        );

        nodes.reverbWet.gain.setTargetAtTime(
            track.reverb / 100 * 0.65,
            now,
            0.015
        );

        nodes.dry.gain.setTargetAtTime(
            1 - track.distortion / 250,
            now,
            0.015
        );

        nodes.distortion.curve = makeDistortionCurve(
            track.distortion
        );

        const shouldSolo =
            state.soloTrackId !== null &&
            state.soloTrackId !== track.id;

        nodes.volume.gain.setTargetAtTime(
            track.muted || shouldSolo ? 0 : track.volume,
            now,
            0.015
        );
    }

    function updateMasterVolume() {
        if (!state.masterGain || !state.audioContext) {
            return;
        }

        const slider = $("mixerVolume");
        const volume = slider
            ? Number(slider.value) / 100
            : 1;

        state.masterGain.gain.setTargetAtTime(
            clamp(volume, 0, 1.5),
            state.audioContext.currentTime,
            0.02
        );

        safeText(
            $("masterLevelText"),
            Math.round(volume * 100) + "%"
        );
    }

    /* =====================================================
       4. TRACK MANAGEMENT
       ===================================================== */

    function createTrack(options = {}) {
        const track = {
            id: state.nextTrackId++,
            name: options.name || "Audio Track",
            type: options.type || "music",
            buffer: options.buffer || null,
            fileName: options.fileName || "",
            volume: options.volume ?? 1,
            pan: options.pan ?? 0,
            bass: options.bass ?? 0,
            mid: options.mid ?? 0,
            treble: options.treble ?? 0,
            reverb: options.reverb ?? 0,
            delay: options.delay ?? 0,
            distortion: options.distortion ?? 0,
            muted: false,
            solo: false,
            startTime: options.startTime ?? 0,
            trimStart: options.trimStart ?? 0,
            trimEnd: options.trimEnd ?? null,
            nodes: null,
            source: null,
            waveform: null,
            selected: false,
            createdAt: Date.now()
        };

        if (track.buffer && track.trimEnd === null) {
            track.trimEnd = track.buffer.duration;
        }

        state.tracks.push(track);

        makeTrackNodes(track);
        renderTrackList();
        renderTimeline();
        updateTrackSelectors();
        saveUndoState();

        return track;
    }

    function getActiveTrack() {
        return state.tracks.find(
            (track) => track.id === state.activeTrackId
        ) || state.tracks.find(
            (track) => track.buffer
        ) || null;
    }

    function selectTrack(trackId) {
        const track = state.tracks.find(
            (item) => item.id === Number(trackId)
        );

        if (!track) {
            return;
        }

        state.activeTrackId = track.id;

        renderTrackList();
        renderTimeline();
        loadTrackControls(track);
        updateTrackInformation(track);
    }

    function loadTrackControls(track) {
        if (!track) {
            return;
        }

        setSlider("volumeControl", track.volume * 100);
        setSlider("panControl", track.pan * 100);
        setSlider("bassControl", track.bass);
        setSlider("midControl", track.mid);
        setSlider("trebleControl", track.treble);
        setSlider("reverbControl", track.reverb);
        setSlider("delayControl", track.delay);
        setSlider("distortionControl", track.distortion);

        safeText(
            $("volumeValue"),
            Math.round(track.volume * 100) + "%"
        );

        safeText($("panValue"), Math.round(track.pan * 100));
        safeText($("bassValue"), track.bass + " dB");
        safeText($("midValue"), track.mid + " dB");
        safeText($("trebleValue"), track.treble + " dB");
        safeText($("reverbValue"), track.reverb + "%");
        safeText($("delayValue"), track.delay + "%");
        safeText(
            $("distortionValue"),
            track.distortion + "%"
        );
    }

    function setSlider(id, value) {
        const element = $(id);

        if (element) {
            element.value = String(value);
        }
    }

    function updateTrackInformation(track) {
        if (!track) {
            return;
        }

        safeText(
            $("currentTrackTitle"),
            track.name
        );

        safeText(
            $("timelineTrackName"),
            track.name
        );

        safeText(
            $("audioFormat"),
            track.buffer
                ? track.buffer.numberOfChannels +
                  " channel • " +
                  track.buffer.sampleRate +
                  " Hz"
                : "No audio loaded"
        );

        safeText(
            $("trackDurationText"),
            formatTime(track.buffer?.duration || 0)
        );

        safeText(
            $("playbackBadge"),
            track.buffer ? "Ready" : "Empty"
        );
    }

    function removeTrack(trackId) {
        const index = state.tracks.findIndex(
            (track) => track.id === Number(trackId)
        );

        if (index === -1) {
            return;
        }

        const track = state.tracks[index];

        if (track.source) {
            try {
                track.source.stop();
            } catch (_) {}
        }

        state.tracks.splice(index, 1);

        if (state.activeTrackId === track.id) {
            state.activeTrackId =
                state.tracks[0]?.id ?? null;
        }

        renderTrackList();
        renderTimeline();
        updateTrackSelectors();

        const active = getActiveTrack();

        if (active) {
            loadTrackControls(active);
            updateTrackInformation(active);
        }

        saveUndoState();
        showToast("Track haqameera.");
    }

    function renderTrackList() {
        const list = $("trackList");

        if (!list) {
            return;
        }

        list.innerHTML = "";

        if (state.tracks.length === 0) {
            const empty = document.createElement("div");

            empty.className = "empty-track-list";
            empty.textContent = "Audio faayila galchi.";

            list.appendChild(empty);
            return;
        }

        state.tracks.forEach((track) => {
            const item = document.createElement("div");

            item.className = "track-list-item";

            if (track.id === state.activeTrackId) {
                item.classList.add("active");
            }

            const title = document.createElement("button");

            title.type = "button";
            title.className = "track-select-button";
            title.textContent = track.name;
            title.addEventListener("click", () => {
                selectTrack(track.id);
            });

            const detail = document.createElement("small");

            detail.textContent = track.buffer
                ? formatTime(track.buffer.duration)
                : "Empty track";

            const mute = document.createElement("button");

            mute.type = "button";
            mute.textContent = track.muted ? "Unmute" : "Mute";

            mute.addEventListener("click", () => {
                track.muted = !track.muted;

                applyTrackEffects(track);
                renderTrackList();
                renderTimeline();
            });

            const remove = document.createElement("button");

            remove.type = "button";
            remove.textContent = "×";
            remove.title = "Remove track";

            remove.addEventListener("click", () => {
                removeTrack(track.id);
            });

            item.append(title, detail, mute, remove);
            list.appendChild(item);
        });
    }

    function updateTrackSelectors() {
        $$(".timeline-track[data-track-type]").forEach(
            (row) => {
                const type = row.dataset.trackType;

                const matchingTrack = state.tracks.find(
                    (track) => track.type === type
                );

                row.dataset.trackId = matchingTrack
                    ? String(matchingTrack.id)
                    : "";
            }
        );
    }

    /* =====================================================
       5. IMPORT AUDIO
       ===================================================== */

    async function decodeAudioFile(file) {
        const context = ensureAudioContext();

        if (!context) {
            throw new Error("Audio engine hin jalqabne.");
        }

        const arrayBuffer = await file.arrayBuffer();

        return await context.decodeAudioData(arrayBuffer);
    }

    async function importAudioFiles(files) {
        const validFiles = Array.from(files || []).filter(
            (file) =>
                file.type.startsWith("audio/") ||
                /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(
                    file.name
                )
        );

        if (validFiles.length === 0) {
            showToast("Faayila audio sirrii filadhu.");
            return;
        }

        setStatus("Audio fe'amaa jira...");

        for (const file of validFiles) {
            try {
                const buffer = await decodeAudioFile(file);

                const track = createTrack({
                    name: file.name,
                    fileName: file.name,
                    type: "music",
                    buffer
                });

                state.activeTrackId = track.id;

                selectTrack(track.id);

                showToast(
                    file.name + " fe'ameera."
                );
            } catch (error) {
                console.error("Audio import failed:", error);

                showToast(
                    file.name +
                    " banamuu hin dandeenye. Faayila biraa yaali."
                );
            }
        }

        setStatus("Audio qophaa'eera.");
        renderTimeline();
        renderTrackList();
    }

    /* =====================================================
       6. WAVEFORM DRAWING
       ===================================================== */

    function drawWaveform(canvas, buffer, color = null) {
        if (!canvas) {
            return;
        }

        const rect = canvas.getBoundingClientRect();

        const width = Math.max(
            300,
            Math.floor(rect.width || canvas.width || 800)
        );

        const height = Math.max(
            60,
            Math.floor(rect.height || canvas.height || 120)
        );

        const dpr = window.devicePixelRatio || 1;

        canvas.width = width * dpr;
        canvas.height = height * dpr;

        const context = canvas.getContext("2d");

        if (!context) {
            return;
        }

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);

        context.fillStyle = "#10131c";
        context.fillRect(0, 0, width, height);

        context.strokeStyle = "#252b3a";
        context.lineWidth = 1;

        context.beginPath();
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();

        if (!buffer) {
            context.fillStyle = "#8991a5";
            context.font = "13px sans-serif";
            context.textAlign = "center";

            context.fillText(
                "Audio galchi; waveform asitti mul'ata",
                width / 2,
                height / 2 - 10
            );

            return;
        }

        const channelCount = buffer.numberOfChannels;
        const channels = [];

        for (let c = 0; c < channelCount; c++) {
            channels.push(buffer.getChannelData(c));
        }

        const samples = channels[0].length;
        const samplesPerPixel = Math.max(
            1,
            Math.floor(samples / width)
        );

        context.fillStyle = color || "#66e0c2";

        for (let x = 0; x < width; x++) {
            const start = x * samplesPerPixel;
            const end = Math.min(
                samples,
                start + samplesPerPixel
            );

            let min = 1;
            let max = -1;

            for (let i = start; i < end; i++) {
                let sample = 0;

                for (const channel of channels) {
                    sample += channel[i] || 0;
                }

                sample /= channelCount;

                if (sample < min) {
                    min = sample;
                }

                if (sample > max) {
                    max = sample;
                }
            }

            const y1 = (1 + min) * height / 2;
            const y2 = (1 + max) * height / 2;

            context.fillRect(
                x,
                y1,
                1,
                Math.max(1, y2 - y1)
            );
        }
    }

    function renderTimeline() {
        const canvas = $("waveformCanvas");
        const empty = $("emptyWaveform");
        const active = getActiveTrack();

        if (canvas) {
            drawWaveform(canvas, active?.buffer || null);

            canvas.style.width =
                Math.max(100, state.zoom * 100) + "%";
        }

        if (empty) {
            empty.hidden = Boolean(active?.buffer);
        }

        const duration = active?.buffer?.duration || 0;

        safeText(
            $("durationDisplay"),
            formatTime(duration)
        );

        safeText(
            $("timeDisplay"),
            formatTime(getCurrentPosition())
        );

        if ($("seekBar")) {
            $("seekBar").max = String(
                Math.max(1, duration * 1000)
            );

            $("seekBar").value = String(
                getCurrentPosition() * 1000
            );
        }

        safeText(
            $("zoomValue"),
            Math.round(state.zoom * 100) + "%"
        );

        const content = $("timelineContent");

        if (content) {
            content.style.minWidth =
                Math.max(100, state.zoom * 100) + "%";
        }

        renderRuler(duration);
        renderTrackClips();
    }

    function renderRuler(duration) {
        const ruler = $("timelineRuler");

        if (!ruler) {
            return;
        }

        ruler.innerHTML = "";

        const seconds = Math.max(10, Math.ceil(duration));
        const interval = seconds > 120 ? 10 :
            seconds > 60 ? 5 : 1;

        for (let second = 0; second <= seconds; second += interval) {
            const marker = document.createElement("span");

            marker.className = "ruler-marker";
            marker.textContent = formatTime(second).split(".")[0];
            marker.style.left =
                (second / seconds) * 100 + "%";

            ruler.appendChild(marker);
        }
    }

    function renderTrackClips() {
        const active = getActiveTrack();

        const mainClip = $("mainAudioClip");
        const voiceClip = $("voiceAudioClip");
        const keyboardClip = $("keyboardAudioClip");

        if (mainClip) {
            mainClip.hidden = true;
        }

        if (voiceClip) {
            voiceClip.hidden = true;
        }

        if (keyboardClip) {
            keyboardClip.hidden = true;
        }

        state.tracks.forEach((track) => {
            let element = null;

            if (track.type === "voice") {
                element = voiceClip;
            } else if (track.type === "keyboard") {
                element = keyboardClip;
            } else {
                element = mainClip;
            }

            if (!element || !track.buffer) {
                return;
            }

            element.hidden = false;
            element.textContent = track.name;
            element.dataset.trackId = String(track.id);

            element.style.left =
                (track.startTime * state.zoom * 100) + "px";

            element.style.width =
                Math.max(
                    50,
                    (track.buffer.duration -
                        track.trimStart -
                        (track.buffer.duration -
                            (track.trimEnd ?? track.buffer.duration))) *
                    state.zoom *
                    100
                ) + "px";

            if (track.id === active?.id) {
                element.classList.add("active");
            } else {
                element.classList.remove("active");
            }
        });

        updatePlayhead();
    }

    function updatePlayhead() {
        const playhead = $("playhead");

        if (!playhead) {
            return;
        }

        const position = getCurrentPosition();

        playhead.style.left =
            (position * state.zoom * 100) + "px";
    }

    /* =====================================================
       7. PLAYBACK
       ===================================================== */

    function getCurrentPosition() {
        if (!state.playing) {
            const active = getActiveTrack();

            if (!active || !state.audioContext) {
                return state.playStartOffset || 0;
            }

            return clamp(
                state.playStartOffset || 0,
                0,
                active.buffer?.duration || 0
            );
        }

        const context = state.audioContext;

        return Math.max(
            0,
            state.playStartOffset +
            (context.currentTime - state.playStartContextTime)
        );
    }

    function stopTrackSources() {
        state.tracks.forEach((track) => {
            if (track.source) {
                try {
                    track.source.onended = null;
                    track.source.stop();
                } catch (_) {}

                try {
                    track.source.disconnect();
                } catch (_) {}

                track.source = null;
            }
        });
    }

    function playAllTracks(startAt = 0) {
        const context = ensureAudioContext();

        if (!context) {
            return;
        }

        if (!state.tracks.some((track) => track.buffer)) {
            showToast("Jalqaba audio galchi.");
            return;
        }

        stopTrackSources();

        state.playing = true;
        state.playStartOffset = Math.max(0, startAt);
        state.playStartContextTime = context.currentTime;

        const speed = clamp(
            readNumber("playbackSpeed", 1),
            0.25,
            2
        );

        state.tracks.forEach((track) => {
            if (!track.buffer || track.muted) {
                return;
            }

            if (
                state.soloTrackId !== null &&
                state.soloTrackId !== track.id
            ) {
                return;
            }

            const source = context.createBufferSource();

            source.buffer = track.buffer;
            source.playbackRate.value = speed;

            makeTrackNodes(track);

            source.connect(track.nodes.input);

            const duration = track.buffer.duration;
            const trackStart = Math.max(
                0,
                startAt - track.startTime
            );

            if (trackStart >= duration) {
                return;
            }

            const trimStart = track.trimStart || 0;
            const trimEnd = track.trimEnd ?? duration;

            const offset = clamp(
                trimStart + trackStart,
                trimStart,
                trimEnd
            );

            const playDuration = Math.max(
                0,
                trimEnd - offset
            );

            if (playDuration <= 0) {
                return;
            }

            source.start(
                0,
                offset,
                playDuration
            );

            track.source = source;
        });

        const playButton = $("playBtn");

        if (playButton) {
            playButton.textContent = "Pause";
        }

        safeText($("playbackBadge"), "Playing");

        setStatus("Audio taphachaa jira.");

        cancelAnimationFrame(state.animationFrame);

        const animate = () => {
            if (!state.playing) {
                return;
            }

            const active = getActiveTrack();
            const duration = active?.buffer?.duration || 0;
            const position = getCurrentPosition();

            safeText(
                $("timeDisplay"),
                formatTime(position)
            );

            if ($("seekBar")) {
                $("seekBar").value = String(
                    position * 1000
                );
            }

            updatePlayhead();
            updateMasterMeter();
            updateTrackMeters();

            if (duration > 0 && position >= duration) {
                stopPlayback();
                return;
            }

            state.animationFrame =
                requestAnimationFrame(animate);
        };

        state.animationFrame =
            requestAnimationFrame(animate);
    }

    function pausePlayback() {
        if (!state.playing) {
            return;
        }

        state.playStartOffset = getCurrentPosition();
        state.playing = false;

        stopTrackSources();

        cancelAnimationFrame(state.animationFrame);

        const button = $("playBtn");

        if (button) {
            button.textContent = "Play";
        }

        safeText($("playbackBadge"), "Paused");
        setStatus("Audio dhaabbate.");

        renderTimeline();
    }

    function stopPlayback() {
        state.playing = false;
        state.playStartOffset = 0;

        stopTrackSources();

        cancelAnimationFrame(state.animationFrame);

        const button = $("playBtn");

        if (button) {
            button.textContent = "Play";
        }

        safeText($("playbackBadge"), "Stopped");
        safeText($("timeDisplay"), formatTime(0));

        if ($("seekBar")) {
            $("seekBar").value = "0";
        }

        setStatus("Playback dhaabbate.");

        renderTimeline();
    }

    function togglePlayback() {
        if (state.playing) {
            pausePlayback();
        } else {
            playAllTracks(getCurrentPosition());
        }
    }

    function seekTo(seconds) {
        const active = getActiveTrack();
        const duration = active?.buffer?.duration || 0;

        state.playStartOffset = clamp(
            seconds,
            0,
            duration
        );

        if (state.playing) {
            playAllTracks(state.playStartOffset);
        } else {
            safeText(
                $("timeDisplay"),
                formatTime(state.playStartOffset)
            );

            updatePlayhead();
        }
    }

    /* =====================================================
       8. TRACK EDITING
       ===================================================== */

    function splitActiveTrack() {
        const track = getActiveTrack();

        if (!track || !track.buffer) {
            showToast("Track audio qabu filadhu.");
            return;
        }

        const position = getCurrentPosition();

        if (
            position <= track.trimStart ||
            position >= (track.trimEnd ?? track.buffer.duration)
        ) {
            showToast(
                "Audio keessaa bakka qooduu barbaaddu filadhu."
            );

            return;
        }

        const first = { ...track };
        const second = { ...track };

        first.id = state.nextTrackId++;
        second.id = state.nextTrackId++;

        first.nodes = null;
        second.nodes = null;
        first.source = null;
        second.source = null;

        first.trimEnd = position;
        second.trimStart = position;

        first.name = track.name + " (A)";
        second.name = track.name + " (B)";

        const originalIndex = state.tracks.indexOf(track);

        state.tracks.splice(
            originalIndex,
            1,
            first,
            second
        );

        state.activeTrackId = first.id;

        makeTrackNodes(first);
        makeTrackNodes(second);

        renderTrackList();
        renderTimeline();
        loadTrackControls(first);

        saveUndoState();

        showToast("Audio bakka filatametti qoodame.");
    }

    function trimActiveTrackStart() {
        const track = getActiveTrack();

        if (!track?.buffer) {
            showToast("Audio track filadhu.");
            return;
        }

        const position = getCurrentPosition();

        if (
            position <= 0 ||
            position >= (track.trimEnd ?? track.buffer.duration)
        ) {
            showToast("Bakka trim sirrii filadhu.");
            return;
        }

        track.trimStart = position;

        saveUndoState();
        renderTimeline();

        showToast("Kutaan jalqabaa trim godhame.");
    }

    function trimActiveTrackEnd() {
        const track = getActiveTrack();

        if (!track?.buffer) {
            showToast("Audio track filadhu.");
            return;
        }

        const position = getCurrentPosition();

        if (
            position <= track.trimStart ||
            position >= track.buffer.duration
        ) {
            showToast("Bakka trim sirrii filadhu.");
            return;
        }

        track.trimEnd = position;

        saveUndoState();
        renderTimeline();

        showToast("Kutaan dhumaa trim godhame.");
    }

    function deleteActiveAudio() {
        const track = getActiveTrack();

        if (!track) {
            showToast("Track filatame hin jiru.");
            return;
        }

        removeTrack(track.id);
    }

    /* =====================================================
       9. LIVE CONTROL ADJUSTMENTS
       ===================================================== */

    function updateActiveControl(controlId, value) {
        const track = getActiveTrack();

        if (!track) {
            return;
        }

        switch (controlId) {
            case "volumeControl":
                track.volume = clamp(value / 100, 0, 1.5);
                safeText($("volumeValue"), value + "%");
                break;

            case "panControl":
                track.pan = clamp(value / 100, -1, 1);
                safeText($("panValue"), value);
                break;

            case "bassControl":
                track.bass = clamp(value, -24, 24);
                safeText($("bassValue"), value + " dB");
                break;

            case "midControl":
                track.mid = clamp(value, -24, 24);
                safeText($("midValue"), value + " dB");
                break;

            case "trebleControl":
                track.treble = clamp(value, -24, 24);
                safeText($("trebleValue"), value + " dB");
                break;

            case "reverbControl":
                track.reverb = clamp(value, 0, 100);
                safeText($("reverbValue"), value + "%");
                break;

            case "delayControl":
                track.delay = clamp(value, 0, 100);
                safeText($("delayValue"), value + "%");
                break;

            case "distortionControl":
                track.distortion = clamp(value, 0, 100);
                safeText(
                    $("distortionValue"),
                    value + "%"
                );
                break;
        }

        applyTrackEffects(track);
    }

    function resetActiveAdjustments() {
        const track = getActiveTrack();

        if (!track) {
            showToast("Track filadhu.");
            return;
        }

        track.volume = 1;
        track.pan = 0;
        track.bass = 0;
        track.mid = 0;
        track.treble = 0;
        track.reverb = 0;
        track.delay = 0;
        track.distortion = 0;

        loadTrackControls(track);
        applyTrackEffects(track);

        saveUndoState();

        showToast("Audio adjustments reset ta'aniiru.");
    }

    function toggleCompare() {
        const track = getActiveTrack();

        if (!track) {
            showToast("Track filadhu.");
            return;
        }

        state.comparing = !state.comparing;

        if (state.comparing) {
            state.beforeCompare = {
                volume: track.volume,
                pan: track.pan,
                bass: track.bass,
                mid: track.mid,
                treble: track.treble,
                reverb: track.reverb,
                delay: track.delay,
                distortion: track.distortion
            };

            track.bass = 0;
            track.mid = 0;
            track.treble = 0;
            track.reverb = 0;
            track.delay = 0;
            track.distortion = 0;

            safeText(
                $("compareStatus"),
                "Original audio"
            );
        } else if (state.beforeCompare) {
            Object.assign(
                track,
                state.beforeCompare
            );

            state.beforeCompare = null;

            safeText(
                $("compareStatus"),
                "Edited audio"
            );
        }

        loadTrackControls(track);
        applyTrackEffects(track);
    }

    /* =====================================================
       10. VOICE RECORDING
       ===================================================== */

    async function startVoiceRecording() {
        if (!navigator.mediaDevices?.getUserMedia) {
            showToast(
                "Microphone browser kana keessatti hin deeggaramu.",
                5000
            );

            return;
        }

        if (!window.MediaRecorder) {
            showToast(
                "Browser kana MediaRecorder hin deeggaru."
            );

            return;
        }

        try {
            state.mediaStream =
                await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

            state.recordingChunks = [];

            let options = {};

            if (
                MediaRecorder.isTypeSupported(
                    "audio/webm;codecs=opus"
                )
            ) {
                options.mimeType = "audio/webm;codecs=opus";
            }

            state.mediaRecorder = new MediaRecorder(
                state.mediaStream,
                options
            );

            state.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    state.recordingChunks.push(event.data);
                }
            };

            state.mediaRecorder.onstop = () => {
                state.recordingBlob = new Blob(
                    state.recordingChunks,
                    {
                        type:
                            state.mediaRecorder.mimeType ||
                            "audio/webm"
                    }
                );

                if (state.recordingUrl) {
                    URL.revokeObjectURL(
                        state.recordingUrl
                    );
                }

                state.recordingUrl = URL.createObjectURL(
                    state.recordingBlob
                );

                const preview = $("recordingPreview");

                if (preview) {
                    preview.src = state.recordingUrl;
                }

                const result = $("recordingResult");

                if (result) {
                    result.hidden = false;
                }

                safeText(
                    $("recordingResultStatus"),
                    "Recording qophaa'eera."
                );

                state.mediaStream?.getTracks().forEach(
                    (track) => track.stop()
                );

                state.mediaStream = null;
                setStatus("Voice recording xumurame.");
            };

            state.recordingStartedAt = Date.now();
            state.recordingElapsedBeforePause = 0;
            state.recordingPaused = false;

            state.mediaRecorder.start(250);

            if ($("recordingOrb")) {
                $("recordingOrb").classList.add("recording");
            }

            safeText($("recordingState"), "Recording...");
            setStatus("Microphone recording jira.");

            startRecordingTimer();

            setButtonEnabled("recordBtn", false);
            setButtonEnabled("pauseRecordBtn", true);
            setButtonEnabled("resumeRecordBtn", false);
            setButtonEnabled("stopRecordBtn", true);
        } catch (error) {
            console.error("Microphone error:", error);

            showToast(
                "Microphone hin banamne. Permission kenni."
            );
        }
    }

    function startRecordingTimer() {
        clearInterval(state.recordingTimer);

        state.recordingTimer = setInterval(() => {
            if (
                !state.mediaRecorder ||
                state.mediaRecorder.state === "inactive"
            ) {
                return;
            }

            const elapsed =
                state.recordingElapsedBeforePause +
                (
                    state.recordingPaused
                        ? 0
                        : (Date.now() -
                            state.recordingStartedAt) / 1000
                );

            safeText(
                $("recordingTimer"),
                formatTime(elapsed)
            );
        }, 100);
    }

    function pauseVoiceRecording() {
        if (
            !state.mediaRecorder ||
            state.mediaRecorder.state !== "recording"
        ) {
            return;
        }

        state.recordingElapsedBeforePause +=
            (Date.now() - state.recordingStartedAt) / 1000;

        state.mediaRecorder.pause();
        state.recordingPaused = true;

        safeText($("recordingState"), "Paused");

        setButtonEnabled("pauseRecordBtn", false);
        setButtonEnabled("resumeRecordBtn", true);
    }

    function resumeVoiceRecording() {
        if (
            !state.mediaRecorder ||
            state.mediaRecorder.state !== "paused"
        ) {
            return;
        }

        state.mediaRecorder.resume();

        state.recordingStartedAt = Date.now();
        state.recordingPaused = false;

        safeText($("recordingState"), "Recording...");

        setButtonEnabled("pauseRecordBtn", true);
        setButtonEnabled("resumeRecordBtn", false);
    }

    function stopVoiceRecording() {
        if (
            !state.mediaRecorder ||
            state.mediaRecorder.state === "inactive"
        ) {
            return;
        }

        clearInterval(state.recordingTimer);

        state.mediaRecorder.stop();

        if ($("recordingOrb")) {
            $("recordingOrb").classList.remove("recording");
        }

        safeText($("recordingState"), "Finished");

        setButtonEnabled("recordBtn", true);
        setButtonEnabled("pauseRecordBtn", false);
        setButtonEnabled("resumeRecordBtn", false);
        setButtonEnabled("stopRecordBtn", false);
    }

    async function useVoiceRecording() {
        if (!state.recordingBlob) {
            showToast("Voice recording hin jiru.");
            return;
        }

        try {
            const buffer = await decodeAudioFile(
                new File(
                    [state.recordingBlob],
                    "voice-recording.webm",
                    {
                        type:
                            state.recordingBlob.type ||
                            "audio/webm"
                    }
                )
            );

            const track = createTrack({
                name: "Voice Recording",
                type: "voice",
                buffer,
                fileName: "voice-recording.webm"
            });

            selectTrack(track.id);

            showToast(
                "Voice recording timeline irratti dabalame."
            );
        } catch (error) {
            console.error(error);

            showToast(
                "Recording decode hin danda'amne."
            );
        }
    }

    function downloadVoiceRecording() {
        if (!state.recordingBlob) {
            showToast("Recording hin jiru.");
            return;
        }

        downloadBlob(
            state.recordingBlob,
            "naol-voice-recording.webm"
        );
    }

    function discardVoiceRecording() {
        if (state.recordingUrl) {
            URL.revokeObjectURL(state.recordingUrl);
        }

        state.recordingUrl = null;
        state.recordingBlob = null;
        state.recordingChunks = [];

        const preview = $("recordingPreview");

        if (preview) {
            preview.removeAttribute("src");
            preview.load();
        }

        const result = $("recordingResult");

        if (result) {
            result.hidden = true;
        }

        safeText(
            $("recordingResultStatus"),
            "Recording hin jiru."
        );

        showToast("Recording haqameera.");
    }

    /* =====================================================
       11. VIRTUAL KEYBOARD
       ===================================================== */

    const keyboardNotes = [
        { name: "C", semitone: 0, black: false },
        { name: "C#", semitone: 1, black: true },
        { name: "D", semitone: 2, black: false },
        { name: "D#", semitone: 3, black: true },
        { name: "E", semitone: 4, black: false },
        { name: "F", semitone: 5, black: false },
        { name: "F#", semitone: 6, black: true },
        { name: "G", semitone: 7, black: false },
        { name: "G#", semitone: 8, black: true },
        { name: "A", semitone: 9, black: false },
        { name: "A#", semitone: 10, black: true },
        { name: "B", semitone: 11, black: false }
    ];

    function getKeyboardInstrument() {
        return $("instrumentSelect")?.value || "piano";
    }

    function getKeyboardOctave() {
        return clamp(
            readNumber("octaveSelect", 4),
            2,
            6
        );
    }

    function getKeyboardVolume() {
        return clamp(
            readNumber("keyboardVolume", 70) / 100,
            0,
            1
        );
    }

    function buildKeyboard() {
        const keyboard = $("pianoKeyboard");

        if (!keyboard) {
            return;
        }

        keyboard.innerHTML = "";

        const octave = getKeyboardOctave();
        const whiteKeys = [];

        for (let oct = octave; oct < octave + 2; oct++) {
            keyboardNotes.forEach((note) => {
                if (note.black) {
                    return;
                }

                const midi = 12 * (oct + 1) + note.semitone;
                const key = document.createElement("button");

                key.type = "button";
                key.className = "piano-key white-key";
                key.dataset.midi = String(midi);
                key.dataset.note = note.name + oct;
                key.textContent = note.name + oct;

                attachKeyboardKeyEvents(key, midi);

                whiteKeys.push(key);
                keyboard.appendChild(key);
            });
        }

        const blackNotes = keyboardNotes.filter(
            (note) => note.black
        );

        let whiteIndex = 0;

        for (let oct = octave; oct < octave + 2; oct++) {
            for (let i = 0; i < keyboardNotes.length; i++) {
                const note = keyboardNotes[i];

                if (note.black) {
                    const midi =
                        12 * (oct + 1) + note.semitone;

                    const key = document.createElement("button");

                    key.type = "button";
                    key.className = "piano-key black-key";
                    key.dataset.midi = String(midi);
                    key.dataset.note = note.name + oct;
                    key.textContent = note.name;

                    const precedingWhiteKeys =
                        keyboardNotes
                            .slice(0, i)
                            .filter(
                                (item) => !item.black
                            ).length;

                    const globalWhiteIndex =
                        (oct - octave) * 7 +
                        precedingWhiteKeys;

                    key.style.left =
                        (
                            (globalWhiteIndex + 1) *
                            (100 / 14) -
                            1.6
                        ) + "%";

                    attachKeyboardKeyEvents(key, midi);

                    keyboard.appendChild(key);
                }
            }
        }

        safeText(
            $("keyboardStatus"),
            "Keyboard qophaa'eera."
        );
    }

    function attachKeyboardKeyEvents(button, midi) {
        const start = (event) => {
            event.preventDefault();

            if (state.keyboardActiveNotes.has(midi)) {
                return;
            }

            button.classList.add("pressed");

            const voice = playKeyboardNote(midi);

            state.keyboardActiveNotes.set(midi, voice);

            if (state.keyboardRecording) {
                state.keyboardRecordingEvents.push({
                    type: "on",
                    midi,
                    time: keyboardRecordingTime()
                });
            }
        };

        const end = (event) => {
            event.preventDefault();

            button.classList.remove("pressed");

            const voice = state.keyboardActiveNotes.get(midi);

            if (voice) {
                stopKeyboardNote(midi);
            }
        };

        button.addEventListener("pointerdown", start);
        button.addEventListener("pointerup", end);
        button.addEventListener("pointerleave", (event) => {
            if (state.keyboardActiveNotes.has(midi)) {
                end(event);
            }
        });

        button.addEventListener("pointercancel", end);
    }

    function playKeyboardNote(midi) {
        const context = ensureAudioContext();

        if (!context) {
            return null;
        }

        const frequency = midiToFrequency(midi);
        const instrument = getKeyboardInstrument();
        const gain = context.createGain();
        const oscillator = context.createOscillator();

        const volume = getKeyboardVolume();

        oscillator.frequency.value = frequency;

        if (instrument === "electric") {
            oscillator.type = "triangle";
        } else if (instrument === "bass") {
            oscillator.type = "sawtooth";
            oscillator.frequency.value = frequency / 2;
        } else if (instrument === "synth") {
            oscillator.type = "sawtooth";
        } else {
            oscillator.type = "sine";
        }

        gain.gain.setValueAtTime(
            0.0001,
            context.currentTime
        );

        gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0002, volume * 0.3),
            context.currentTime + 0.025
        );

        oscillator.connect(gain);
        gain.connect(state.masterGain);

        oscillator.start();

        return {
            oscillator,
            gain,
            midi,
            released: false
        };
    }

    function stopKeyboardNote(midi) {
        const voice = state.keyboardActiveNotes.get(midi);

        if (!voice || !state.audioContext) {
            return;
        }

        state.keyboardActiveNotes.delete(midi);

        if (state.keyboardRecording) {
            state.keyboardRecordingEvents.push({
                type: "off",
                midi,
                time: keyboardRecordingTime()
            });
        }

        const now = state.audioContext.currentTime;

        try {
            voice.gain.gain.cancelScheduledValues(now);

            voice.gain.gain.setTargetAtTime(
                0.0001,
                now,
                0.04
            );

            voice.oscillator.stop(now + 0.2);
        } catch (_) {}
    }

    function keyboardRecordingTime() {
        if (!state.keyboardRecording) {
            return 0;
        }

        const now = state.keyboardPaused
            ? state.keyboardRecordingPausedAt
            : performance.now();

        return Math.max(
            0,
            (
                now -
                state.keyboardRecordingStart -
                state.keyboardRecordingPauseTotal
            ) / 1000
        );
    }

    function startKeyboardRecording() {
        state.keyboardRecordingEvents = [];
        state.keyboardRecordingStart = performance.now();
        state.keyboardRecordingPauseTotal = 0;
        state.keyboardPaused = false;
        state.keyboardRecording = true;

        safeText(
            $("keyboardStatus"),
            "Keyboard recording..."
        );

        setButtonEnabled("recordKeyboardBtn", false);
        setButtonEnabled("pauseKeyboardBtn", true);
        setButtonEnabled("resumeKeyboardBtn", false);
        setButtonEnabled("stopKeyboardBtn", true);

        clearInterval(state.keyboardTimer);

        state.keyboardTimer = setInterval(() => {
            if (state.keyboardRecording) {
                safeText(
                    $("recordingTimer"),
                    formatTime(keyboardRecordingTime())
                );
            }
        }, 100);
    }

    function pauseKeyboardRecording() {
        if (!state.keyboardRecording || state.keyboardPaused) {
            return;
        }

        state.keyboardRecordingPausedAt = performance.now();
        state.keyboardPaused = true;

        safeText(
            $("keyboardStatus"),
            "Keyboard recording paused."
        );

        setButtonEnabled("pauseKeyboardBtn", false);
        setButtonEnabled("resumeKeyboardBtn", true);
    }

    function resumeKeyboardRecording() {
        if (!state.keyboardRecording || !state.keyboardPaused) {
            return;
        }

        state.keyboardRecordingPauseTotal +=
            performance.now() -
            state.keyboardRecordingPausedAt;

        state.keyboardPaused = false;

        safeText(
            $("keyboardStatus"),
            "Keyboard recording..."
        );

        setButtonEnabled("pauseKeyboardBtn", true);
        setButtonEnabled("resumeKeyboardBtn", false);
    }

    function stopKeyboardRecording() {
        if (!state.keyboardRecording) {
            return;
        }

        state.keyboardRecording = false;
        state.keyboardPaused = false;

        clearInterval(state.keyboardTimer);

        for (const midi of state.keyboardActiveNotes.keys()) {
            stopKeyboardNote(midi);
        }

        safeText(
            $("keyboardStatus"),
            "Keyboard recording xumurame."
        );

        setButtonEnabled("recordKeyboardBtn", true);
        setButtonEnabled("pauseKeyboardBtn", false);
        setButtonEnabled("resumeKeyboardBtn", false);
        setButtonEnabled("stopKeyboardBtn", false);
    }

    async function createKeyboardRecordingBuffer() {
        const events = state.keyboardRecordingEvents.slice();

        if (events.length === 0) {
            showToast("Keyboard note hin waraabamne.");
            return null;
        }

        const sampleRate = 44100;

        const duration = Math.max(
            1,
            ...events.map((event) => event.time)
        ) + 1;

        const frameCount = Math.ceil(
            duration * sampleRate
        );

        const OfflineContext =
            window.OfflineAudioContext ||
            window.webkitOfflineAudioContext;

        if (!OfflineContext) {
            showToast(
                "Offline audio render browser kana keessatti hin deeggaramu."
            );

            return null;
        }

        const offline = new OfflineContext(
            2,
            frameCount,
            sampleRate
        );

        const active = new Map();

        events.forEach((event) => {
            const time = clamp(
                event.time,
                0,
                duration
            );

            if (event.type === "on") {
                const oscillator = offline.createOscillator();
                const gain = offline.createGain();

                oscillator.type =
                    getKeyboardInstrument() === "piano"
                        ? "sine"
                        : "triangle";

                oscillator.frequency.value =
                    midiToFrequency(event.midi);

                gain.gain.setValueAtTime(
                    0.0001,
                    time
                );

                gain.gain.linearRampToValueAtTime(
                    getKeyboardVolume() * 0.3,
                    time + 0.02
                );

                oscillator.connect(gain);
                gain.connect(offline.destination);

                oscillator.start(time);

                active.set(event.midi, {
                    oscillator,
                    gain
                });
            } else {
                const voice = active.get(event.midi);

                if (!voice) {
                    return;
                }

                voice.gain.gain.setTargetAtTime(
                    0.0001,
                    time,
                    0.03
                );

                try {
                    voice.oscillator.stop(time + 0.2);
                } catch (_) {}

                active.delete(event.midi);
            }
        });

        active.forEach((voice) => {
            try {
                voice.gain.gain.setTargetAtTime(
                    0.0001,
                    duration - 0.2,
                    0.03
                );

                voice.oscillator.stop(duration);
            } catch (_) {}
        });

        return await offline.startRendering();
    }

    async function useKeyboardRecording() {
        const buffer = await createKeyboardRecordingBuffer();

        if (!buffer) {
            return;
        }

        state.keyboardAudioBuffer = buffer;

        const track = createTrack({
            name: "Keyboard Recording",
            type: "keyboard",
            buffer
        });

        selectTrack(track.id);

        showToast(
            "Keyboard recording timeline irratti dabalame."
        );
    }

    async function downloadKeyboardRecording() {
        const buffer = await createKeyboardRecordingBuffer();

        if (!buffer) {
            return;
        }

        const wav = audioBufferToWav(buffer);

        downloadBlob(
            wav,
            "naol-keyboard-recording.wav"
        );
    }

    async function playKeyboardRecording() {
        const buffer = await createKeyboardRecordingBuffer();

        if (!buffer) {
            return;
        }

        const track = createTrack({
            name: "Keyboard Preview",
            type: "keyboard",
            buffer
        });

        selectTrack(track.id);
        playAllTracks(0);
    }

    /* =====================================================
       12. PRESETS
       ===================================================== */

    const presets = {
        clean: {
            bass: 0,
            mid: 0,
            treble: 0,
            reverb: 0,
            delay: 0,
            distortion: 0,
            volume: 100
        },

        warm: {
            bass: 4,
            mid: 1,
            treble: -2,
            reverb: 15,
            delay: 4,
            distortion: 0,
            volume: 95
        },

        bright: {
            bass: -1,
            mid: 1,
            treble: 5,
            reverb: 8,
            delay: 0,
            distortion: 0,
            volume: 100
        },

        rap: {
            bass: 5,
            mid: -1,
            treble: 3,
            reverb: 4,
            delay: 2,
            distortion: 8,
            volume: 95
        },

        gospel: {
            bass: 2,
            mid: 1,
            treble: 3,
            reverb: 35,
            delay: 12,
            distortion: 0,
            volume: 95
        },

        studio: {
            bass: 2,
            mid: 0,
            treble: 2,
            reverb: 10,
            delay: 3,
            distortion: 0,
            volume: 100
        }
    };

    function applyPreset(name) {
        const track = getActiveTrack();
        const preset = presets[name];

        if (!track || !preset) {
            showToast(
                "Preset fayyadamuuf track audio qabu filadhu."
            );

            return;
        }

        track.bass = preset.bass;
        track.mid = preset.mid;
        track.treble = preset.treble;
        track.reverb = preset.reverb;
        track.delay = preset.delay;
        track.distortion = preset.distortion;
        track.volume = preset.volume / 100;

        loadTrackControls(track);
        applyTrackEffects(track);

        safeText(
            $("presetStatus"),
            "Preset: " + name
        );

        saveUndoState();

        showToast(
            name.charAt(0).toUpperCase() +
            name.slice(1) +
            " preset applied."
        );
    }

    /* =====================================================
       13. MIXER METERS
       ===================================================== */

    function updateMasterMeter() {
        if (!state.masterAnalyser) {
            return;
        }

        const data = new Uint8Array(
            state.masterAnalyser.fftSize
        );

        state.masterAnalyser.getByteTimeDomainData(data);

        let sum = 0;
        let peak = 0;

        for (const byte of data) {
            const sample = (byte - 128) / 128;

            sum += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
        }

        const rms = Math.sqrt(sum / data.length);

        const meter = $("masterMeter");

        if (meter) {
            const level = clamp(rms * 220, 0, 100);

            meter.style.width = level + "%";
            meter.setAttribute("aria-valuenow", String(level));
        }

        const clipping = $("clippingStatus");

        if (clipping) {
            clipping.textContent =
                peak > 0.98 ? "Clipping risk" : "Signal OK";

            clipping.classList.toggle(
                "clipping",
                peak > 0.98
            );
        }
    }

    function updateTrackMeters() {
        state.tracks.forEach((track) => {
            if (!track.nodes?.analyser) {
                return;
            }

            const analyser = track.nodes.analyser;

            const data = new Uint8Array(
                analyser.fftSize
            );

            analyser.getByteTimeDomainData(data);

            let sum = 0;

            for (const byte of data) {
                const sample = (byte - 128) / 128;
                sum += sample * sample;
            }

            const rms = Math.sqrt(sum / data.length);

            const meterId =
                track.type === "voice"
                    ? "voiceMeter"
                    : track.type === "keyboard"
                        ? "keyboardMeter"
                        : "audioMeter";

            const meter = $(meterId);

            if (meter) {
                meter.style.width =
                    clamp(rms * 220, 0, 100) + "%";
            }
        });
    }

    /* =====================================================
       14. AUDIO ANALYSIS
       ===================================================== */

    function analyseActiveAudio() {
        const track = getActiveTrack();

        if (!track?.buffer) {
            showToast("Analysis gochuuf audio galchi.");
            return;
        }

        const buffer = track.buffer;

        let peak = 0;
        let sumSquares = 0;
        let count = 0;

        for (
            let channel = 0;
            channel < buffer.numberOfChannels;
            channel++
        ) {
            const data = buffer.getChannelData(channel);

            for (let i = 0; i < data.length; i++) {
                const value = data[i];

                peak = Math.max(peak, Math.abs(value));
                sumSquares += value * value;
                count++;
            }
        }

        const rms = count
            ? Math.sqrt(sumSquares / count)
            : 0;

        const peakDb = peak > 0
            ? 20 * Math.log10(peak)
            : -Infinity;

        const rmsDb = rms > 0
            ? 20 * Math.log10(rms)
            : -Infinity;

        safeText(
            $("analysisDuration"),
            formatTime(buffer.duration)
        );

        safeText(
            $("analysisPeak"),
            Number.isFinite(peakDb)
                ? peakDb.toFixed(2) + " dBFS"
                : "-∞ dBFS"
        );

        safeText(
            $("analysisRms"),
            Number.isFinite(rmsDb)
                ? rmsDb.toFixed(2) + " dBFS"
                : "-∞ dBFS"
        );

        safeText(
            $("analysisSampleRate"),
            buffer.sampleRate + " Hz"
        );

        safeText(
            $("analysisStatus"),
            "Analysis complete"
        );

        state.lastAnalysis = {
            duration: buffer.duration,
            peak,
            peakDb,
            rms,
            rmsDb,
            sampleRate: buffer.sampleRate
        };

        showToast("Audio analysis xumurame.");
    }

    /* =====================================================
       15. OFFLINE MIX AND WAV EXPORT
       ===================================================== */

    function audioBufferToWav(buffer) {
        const channels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const length = buffer.length;

        const bytesPerSample = 2;
        const blockAlign = channels * bytesPerSample;
        const dataSize = length * blockAlign;

        const arrayBuffer = new ArrayBuffer(
            44 + dataSize
        );

        const view = new DataView(arrayBuffer);

        const writeString = (offset, text) => {
            for (let i = 0; i < text.length; i++) {
                view.setUint8(offset + i, text.charCodeAt(i));
            }
        };

        writeString(0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, "WAVE");
        writeString(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(
            28,
            sampleRate * blockAlign,
            true
        );
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        writeString(36, "data");
        view.setUint32(40, dataSize, true);

        let offset = 44;

        const channelData = [];

        for (let c = 0; c < channels; c++) {
            channelData.push(buffer.getChannelData(c));
        }

        for (let i = 0; i < length; i++) {
            for (let c = 0; c < channels; c++) {
                let sample = channelData[c][i] || 0;

                sample = clamp(sample, -1, 1);

                const intSample = sample < 0
                    ? sample * 0x8000
                    : sample * 0x7fff;

                view.setInt16(
                    offset,
                    intSample,
                    true
                );

                offset += 2;
            }
        }

        return new Blob(
            [arrayBuffer],
            { type: "audio/wav" }
        );
    }

    async function renderOfflineMix() {
        const availableTracks = state.tracks.filter(
            (track) => track.buffer
        );

        if (availableTracks.length === 0) {
            throw new Error("Audio track hin jiru.");
        }

        const sampleRate = clamp(
            readNumber("exportSampleRate", 44100),
            22050,
            96000
        );

        const channels =
            $("exportChannels")?.value === "mono" ? 1 : 2;

        const endTime = Math.max(
            ...availableTracks.map((track) => {
                const end =
                    track.trimEnd ??
                    track.buffer.duration;

                return (
                    track.startTime +
                    Math.max(0, end - track.trimStart)
                );
            })
        );

        const length = Math.max(
            1,
            Math.ceil(endTime * sampleRate)
        );

        const OfflineContext =
            window.OfflineAudioContext ||
            window.webkitOfflineAudioContext;

        if (!OfflineContext) {
            throw new Error(
                "OfflineAudioContext hin deeggaramu."
            );
        }

        const offline = new OfflineContext(
            channels,
            length,
            sampleRate
        );

        const master = offline.createGain();

        const masterVolume = clamp(
            readNumber("mixerVolume", 100) / 100,
            0,
            1.5
        );

        master.gain.value = masterVolume;

        master.connect(offline.destination);

        const exportSource =
            $("exportSource")?.value || "mix";

        availableTracks.forEach((track) => {
            if (
                exportSource === "music" &&
                track.type !== "music"
            ) {
                return;
            }

            if (
                track.muted ||
                (
                    state.soloTrackId !== null &&
                    state.soloTrackId !== track.id
                )
            ) {
                return;
            }

            const source = offline.createBufferSource();
            const gain = offline.createGain();
            const pan = offline.createStereoPanner();

            const bass = offline.createBiquadFilter();
            const mid = offline.createBiquadFilter();
            const treble = offline.createBiquadFilter();

            const delay = offline.createDelay(2);
            const delayWet = offline.createGain();

            const reverb = offline.createConvolver();
            const reverbWet = offline.createGain();

            source.buffer = track.buffer;

            bass.type = "lowshelf";
            bass.frequency.value = 180;
            bass.gain.value = track.bass;

            mid.type = "peaking";
            mid.frequency.value = 1000;
            mid.Q.value = 0.8;
            mid.gain.value = track.mid;

            treble.type = "highshelf";
            treble.frequency.value = 5000;
            treble.gain.value = track.treble;

            pan.pan.value = track.pan;
            gain.gain.value = track.volume;

            delay.delayTime.value = 0.18;
            delayWet.gain.value = track.delay / 100 * 0.5;

            reverbWet.gain.value =
                track.reverb / 100 * 0.5;

            const impulseLength = Math.floor(
                sampleRate * 1.0
            );

            const impulse = offline.createBuffer(
                2,
                impulseLength,
                sampleRate
            );

            for (let c = 0; c < 2; c++) {
                const data = impulse.getChannelData(c);

                for (let i = 0; i < impulseLength; i++) {
                    data[i] =
                        (Math.random() * 2 - 1) *
                        Math.pow(
                            1 - i / impulseLength,
                            2
                        );
                }
            }

            reverb.buffer = impulse;

            source.connect(bass);
            bass.connect(mid);
            mid.connect(treble);
            treble.connect(gain);

            gain.connect(pan);
            pan.connect(master);

            gain.connect(delay);
            delay.connect(delayWet);
            delayWet.connect(master);

            gain.connect(reverb);
            reverb.connect(reverbWet);
            reverbWet.connect(master);

            const offset = clamp(
                track.trimStart,
                0,
                track.buffer.duration
            );

            const end = clamp(
                track.trimEnd ?? track.buffer.duration,
                offset,
                track.buffer.duration
            );

            const duration = Math.max(0, end - offset);

            if (duration <= 0) {
                return;
            }

            const startTime = Math.max(0, track.startTime);

            source.start(
                startTime,
                offset,
                duration
            );
        });

        let rendered = await offline.startRendering();

        if (channels === 1 && rendered.numberOfChannels > 1) {
            const monoContext = new OfflineContext(
                1,
                rendered.length,
                rendered.sampleRate
            );

            const monoBuffer = monoContext.createBuffer(
                1,
                rendered.length,
                rendered.sampleRate
            );

            const left = rendered.getChannelData(0);
            const right = rendered.getChannelData(1);
            const mono = monoBuffer.getChannelData(0);

            for (let i = 0; i < mono.length; i++) {
                mono[i] = (left[i] + right[i]) / 2;
            }

            rendered = monoBuffer;
        }

        if ($("normalizeExport")?.checked) {
            let peak = 0;

            for (
                let channel = 0;
                channel < rendered.numberOfChannels;
                channel++
            ) {
                const data = rendered.getChannelData(channel);

                for (let i = 0; i < data.length; i++) {
                    peak = Math.max(
                        peak,
                        Math.abs(data[i])
                    );
                }
            }

            if (peak > 0) {
                const multiplier = 0.98 / peak;

                for (
                    let channel = 0;
                    channel < rendered.numberOfChannels;
                      channel++
                ) {
                    const data = rendered.getChannelData(channel);

                    for (let i = 0; i < data.length; i++) {
                        data[i] *= multiplier;
                    }
                }
            }
        }

        return rendered;
    }

    async function exportAudio() {
        const button = $("exportBtn");

        if (button) {
            button.disabled = true;
        }

        const progressWrap = $("exportProgressWrap");

        if (progressWrap) {
            progressWrap.hidden = false;
        }

        safeText($("exportProgressText"), "Rendering audio...");
        safeText($("exportProgressPercent"), "10%");

        if ($("exportProgress")) {
            $("exportProgress").value = 10;
        }

        try {
            const format =
                $("exportFormat")?.value || "wav";

            if (format === "mp3") {
                showToast(
                    "MP3 export'f encoder hin jiru. WAV filadhu."
                );

                safeText(
                    $("exportStatus"),
                    "MP3 encoder hin jiru. WAV fayyadami."
                );

                return;
            }

            const buffer = await renderOfflineMix();

            safeText(
                $("exportProgressText"),
                "WAV qophaa'aa jira..."
            );

            safeText(
                $("exportProgressPercent"),
                "80%"
            );

            if ($("exportProgress")) {
                $("exportProgress").value = 80;
            }

            const wav = audioBufferToWav(buffer);

            state.exportBlob = wav;

            if (state.exportUrl) {
                URL.revokeObjectURL(state.exportUrl);
            }

            state.exportUrl = URL.createObjectURL(wav);

            const filename =
                ($("exportFileName")?.value || "naol-mix")
                    .trim()
                    .replace(/[\\/:*?"<>|]+/g, "-");

            downloadBlob(
                state.exportBlob,
                filename.toLowerCase().endsWith(".wav")
                    ? filename
                    : filename + ".wav"
            );

            safeText(
                $("exportProgressText"),
                "Export complete"
            );

            safeText(
                $("exportProgressPercent"),
                "100%"
            );

            if ($("exportProgress")) {
                $("exportProgress").value = 100;
            }

            safeText(
                $("exportStatus"),
                "WAV export xumurame."
            );

            setButtonEnabled("downloadExportBtn", true);

            showToast("WAV file buufachuun jalqabame.");
        } catch (error) {
            console.error("Export failed:", error);

            safeText(
                $("exportStatus"),
                "Export failed: " + error.message
            );

            showToast(
                "Export hin milkoofne. Audio galchuu mirkaneessi."
            );
        } finally {
            if (button) {
                button.disabled = false;
            }
        }
    }

    function downloadExport() {
        if (!state.exportBlob) {
            showToast("Jalqaba export godhi.");
            return;
        }

        const filename =
            ($("exportFileName")?.value || "naol-mix")
                .trim()
                .replace(/[\\/:*?"<>|]+/g, "-");

        downloadBlob(
            state.exportBlob,
            filename.toLowerCase().endsWith(".wav")
                ? filename
                : filename + ".wav"
        );
    }

    function updateExportSummary() {
        const active = getActiveTrack();

        safeText(
            $("exportDuration"),
            formatTime(active?.buffer?.duration || 0)
        );

        safeText(
            $("exportFormatSummary"),
            $("exportFormat")?.value?.toUpperCase() || "WAV"
        );

        safeText(
            $("exportSampleRateSummary"),
            ($("exportSampleRate")?.value || "44100") +
            " Hz"
        );

        safeText(
            $("exportQualitySummary"),
            $("exportQuality")?.value || "High"
        );
    }

    /* =====================================================
       16. PROJECT SAVE AND RESTORE
       ===================================================== */

    function serialiseProject() {
        return {
            version: 1,
            name: state.projectName,
            savedAt: new Date().toISOString(),
            tracks: state.tracks.map((track) => ({
                id: track.id,
                name: track.name,
                type: track.type,
                fileName: track.fileName,
                volume: track.volume,
                pan: track.pan,
                bass: track.bass,
                mid: track.mid,
                treble: track.treble,
                reverb: track.reverb,
                delay: track.delay,
                distortion: track.distortion,
                muted: track.muted,
                startTime: track.startTime,
                trimStart: track.trimStart,
                trimEnd: track.trimEnd
            }))
        };
    }

    function saveProjectState() {
        try {
            const project = serialiseProject();

            localStorage.setItem(
                "naolMusicStudioProject",
                JSON.stringify(project)
            );

            const name = $("projectName");

            if (name) {
                state.projectName = name.value ||
                    "Naol Music Studio 3D";
            }

            safeText($("saveStatus"), "Saved");
            safeText($("projectState"), "Project saved");

            showToast(
                "Project settings browser keessatti olkaa'aman."
            );
        } catch (error) {
            console.error(error);

            showToast(
                "Project save hin danda'amne."
            );
        }
    }

    function backupProject() {
        const project = serialiseProject();

        const blob = new Blob(
            [JSON.stringify(project, null, 2)],
            { type: "application/json" }
        );

        downloadBlob(
            blob,
            "naol-music-studio-project.json"
        );
    }

    function restoreProjectFile(file) {
        if (!file) {
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {
            try {
                const project = JSON.parse(reader.result);

                if (!project || !Array.isArray(project.tracks)) {
                    throw new Error("Project format sirrii miti.");
                }

                project.tracks.forEach((savedTrack) => {
                    const existing = state.tracks.find(
                        (track) =>
                            track.name === savedTrack.name &&
                            track.type === savedTrack.type
                    );

                    if (existing) {
                        Object.assign(existing, {
                            volume: savedTrack.volume ?? 1,
                            pan: savedTrack.pan ?? 0,
                            bass: savedTrack.bass ?? 0,
                            mid: savedTrack.mid ?? 0,
                            treble: savedTrack.treble ?? 0,
                            reverb: savedTrack.reverb ?? 0,
                            delay: savedTrack.delay ?? 0,
                            distortion: savedTrack.distortion ?? 0,
                            startTime: savedTrack.startTime ?? 0,
                            trimStart: savedTrack.trimStart ?? 0,
                            trimEnd: savedTrack.trimEnd ??
                                existing.buffer?.duration ??
                                null,
                            muted: Boolean(savedTrack.muted)
                        });

                        applyTrackEffects(existing);
                    }
                });

                state.projectName =
                    project.name || state.projectName;

                if ($("projectName")) {
                    $("projectName").value =
                        state.projectName;
                }

                renderTrackList();
                renderTimeline();

                showToast(
                    "Project settings restore ta'aniiru. Audio faayiloota yoo barbaachise irra deebi'ii galchi."
                );
            } catch (error) {
                console.error(error);

                showToast(
                    "Project file dubbisuu hin dandeenye."
                );
            }
        };

        reader.readAsText(file);
    }

    /* =====================================================
       17. UNDO / REDO
       ===================================================== */

    function snapshotState() {
        return state.tracks.map((track) => ({
            id: track.id,
            name: track.name,
            type: track.type,
            buffer: track.buffer,
            fileName: track.fileName,
            volume: track.volume,
            pan: track.pan,
            bass: track.bass,
            mid: track.mid,
            treble: track.treble,
            reverb: track.reverb,
            delay: track.delay,
            distortion: track.distortion,
            muted: track.muted,
            solo: track.solo,
            startTime: track.startTime,
            trimStart: track.trimStart,
            trimEnd: track.trimEnd
        }));
    }

    function saveUndoState() {
        state.undoStack.push(snapshotState());

        if (state.undoStack.length > 40) {
            state.undoStack.shift();
        }

        state.redoStack = [];

        setButtonEnabled(
            "undoBtn",
            state.undoStack.length > 1
        );

        setButtonEnabled("redoBtn", false);
    }

    function restoreSnapshot(snapshot) {
        stopPlayback();

        state.tracks = snapshot.map((saved) => {
            const track = { ...saved };

            track.nodes = null;
            track.source = null;

            makeTrackNodes(track);

            return track;
        });

        state.activeTrackId =
            state.tracks[0]?.id ?? null;

        renderTrackList();
        renderTimeline();
        updateTrackSelectors();

        const active = getActiveTrack();

        if (active) {
            loadTrackControls(active);
            updateTrackInformation(active);
        }
    }

    function undo() {
        if (state.undoStack.length <= 1) {
            showToast("Undo history hin jiru.");
            return;
        }

        const current = state.undoStack.pop();

        state.redoStack.push(current);

        const previous = state.undoStack[
            state.undoStack.length - 1
        ];

        restoreSnapshot(previous);

        setButtonEnabled(
            "undoBtn",
            state.undoStack.length > 1
        );

        setButtonEnabled(
            "redoBtn",
            state.redoStack.length > 0
        );
    }

    function redo() {
        if (state.redoStack.length === 0) {
            showToast("Redo history hin jiru.");
            return;
        }

        const next = state.redoStack.pop();

        state.undoStack.push(next);

        restoreSnapshot(next);

        setButtonEnabled(
            "undoBtn",
            state.undoStack.length > 1
        );

        setButtonEnabled(
            "redoBtn",
            state.redoStack.length > 0
        );
    }

    /* =====================================================
       18. NAVIGATION AND UI
       ===================================================== */

    function navigateToSection(sectionId) {
        const section = $(sectionId);

        if (!section) {
            return;
        }

        $$(".nav-item").forEach((item) => {
            item.classList.toggle(
                "active",
                item.dataset.section === sectionId
            );
        });

        $$(".app-section").forEach((item) => {
            item.classList.toggle(
                "active",
                item.id === sectionId
            );
        });

        section.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    function setupNavigation() {
        $$(".nav-item[data-section]").forEach((button) => {
            button.addEventListener("click", () => {
                navigateToSection(
                    button.dataset.section
                );
            });
        });
    }

    function setupDropZone() {
        const zone = $("uploadDropZone");
        const input = $("audioUpload");

        if (!zone || !input) {
            return;
        }

        zone.addEventListener("click", () => {
            input.click();
        });

        zone.addEventListener("dragover", (event) => {
            event.preventDefault();
            zone.classList.add("dragover");
        });

        zone.addEventListener("dragleave", () => {
            zone.classList.remove("dragover");
        });

        zone.addEventListener("drop", (event) => {
            event.preventDefault();

            zone.classList.remove("dragover");

            importAudioFiles(
                event.dataTransfer.files
            );
        });

        input.addEventListener("change", (event) => {
            importAudioFiles(event.target.files);

            input.value = "";
        });
    }

    function setupTrackActions() {
        $$("[data-track-action]").forEach((button) => {
            button.addEventListener("click", () => {
                const action =
                    button.dataset.trackAction;

                const type =
                    button.dataset.track;

                const track = state.tracks.find(
                    (item) => item.type === type
                );

                if (!track) {
                    showToast(
                        "Track " + type + " hin jiru."
                    );

                    return;
                }

                if (action === "mute") {
                    track.muted = !track.muted;
                } else if (action === "solo") {
                    state.soloTrackId =
                        state.soloTrackId === track.id
                            ? null
                            : track.id;
                }

                applyTrackEffects(track);
                renderTrackList();
            });
        });
    }

    function setupControlListeners() {
        const sliderIds = [
            "volumeControl",
            "panControl",
            "bassControl",
            "midControl",
            "trebleControl",
            "reverbControl",
            "delayControl",
            "distortionControl"
        ];

        sliderIds.forEach((id) => {
            const element = $(id);

            if (!element) {
                return;
            }

            element.addEventListener("input", () => {
                updateActiveControl(
                    id,
                    Number(element.value)
                );
            });

            element.addEventListener("change", () => {
                saveUndoState();
            });
        });

        $("resetAdjustmentsBtn")?.addEventListener(
            "click",
            resetActiveAdjustments
        );

        $("compareBtn")?.addEventListener(
            "click",
            toggleCompare
        );

        $("fadeInControl")?.addEventListener(
            "input",
            (event) => {
                safeText(
                    $("fadeInValue"),
                    event.target.value + " s"
                );
            }
        );

        $("fadeOutControl")?.addEventListener(
            "input",
            (event) => {
                safeText(
                    $("fadeOutValue"),
                    event.target.value + " s"
                );
            }
        );
    }

    function setupPlaybackControls() {
        $("playBtn")?.addEventListener(
            "click",
            togglePlayback
        );

        $("stopBtn")?.addEventListener(
            "click",
            stopPlayback
        );

        $("restartBtn")?.addEventListener(
            "click",
            () => {
                stopPlayback();
                playAllTracks(0);
            }
        );

        $("seekBar")?.addEventListener(
            "input",
            (event) => {
                seekTo(Number(event.target.value) / 1000);
            }
        );

        $("zoomInBtn")?.addEventListener(
            "click",
            () => {
                state.zoom = clamp(
                    state.zoom * 1.25,
                    0.25,
                    10
                );

                renderTimeline();
            }
        );

        $("zoomOutBtn")?.addEventListener(
            "click",
            () => {
                state.zoom = clamp(
                    state.zoom / 1.25,
                    0.25,
                    10
                );

                renderTimeline();
            }
        );

        $("fitTimelineBtn")?.addEventListener(
            "click",
            () => {
                state.zoom = 1;
                renderTimeline();
            }
        );

        $("splitBtn")?.addEventListener(
            "click",
            splitActiveTrack
        );

        $("trimStartBtn")?.addEventListener(
            "click",
            trimActiveTrackStart
        );

        $("trimEndBtn")?.addEventListener(
            "click",
            trimActiveTrackEnd
        );

        $("deleteAudioBtn")?.addEventListener(
            "click",
            deleteActiveAudio
        );

        $("playbackSpeed")?.addEventListener(
            "change",
            () => {
                if (state.playing) {
                    const position = getCurrentPosition();

                    playAllTracks(position);
                }
            }
        );

        $("addTrackBtn")?.addEventListener(
            "click",
            () => {
                const track = createTrack({
                    name:
                        "New Track " +
                        (state.tracks.length + 1),
                    type: "music"
                });

                selectTrack(track.id);

                showToast("Track haaraan uumame.");
            }
        );
    }

    function setupVoiceControls() {
        $("recordBtn")?.addEventListener(
            "click",
            startVoiceRecording
        );

        $("pauseRecordBtn")?.addEventListener(
            "click",
            pauseVoiceRecording
        );

        $("resumeRecordBtn")?.addEventListener(
            "click",
            resumeVoiceRecording
        );

        $("stopRecordBtn")?.addEventListener(
            "click",
            stopVoiceRecording
        );

        $("downloadRecordingBtn")?.addEventListener(
            "click",
            downloadVoiceRecording
        );

        $("useRecordingBtn")?.addEventListener(
            "click",
            useVoiceRecording
        );

        $("discardRecordingBtn")?.addEventListener(
            "click",
            discardVoiceRecording
        );

        $$(".preset-button[data-preset]").forEach(
            (button) => {
                button.addEventListener("click", () => {
                    applyPreset(button.dataset.preset);
                });
            }
        );

        const monitoring = $("monitoringControl");

        monitoring?.addEventListener("input", () => {
            safeText(
                $("monitoringValue"),
                monitoring.value + "%"
            );
        });
    }

    function setupKeyboardControls() {
        $("instrumentSelect")?.addEventListener(
            "change",
            buildKeyboard
        );

        $("octaveSelect")?.addEventListener(
            "change",
            buildKeyboard
        );

        $("recordKeyboardBtn")?.addEventListener(
            "click",
            startKeyboardRecording
        );

        $("pauseKeyboardBtn")?.addEventListener(
            "click",
            pauseKeyboardRecording
        );

        $("resumeKeyboardBtn")?.addEventListener(
            "click",
            resumeKeyboardRecording
        );

        $("stopKeyboardBtn")?.addEventListener(
            "click",
            stopKeyboardRecording
        );

        $("playKeyboardRecordingBtn")?.addEventListener(
            "click",
            playKeyboardRecording
        );

        $("useKeyboardRecordingBtn")?.addEventListener(
            "click",
            useKeyboardRecording
        );

        $("downloadKeyboardRecordingBtn")?.addEventListener(
            "click",
            downloadKeyboardRecording
        );

        $("sustainBtn")?.addEventListener(
            "click",
            () => {
                const button = $("sustainBtn");

                if (!button) {
                    return;
                }

                const enabled =
                    button.dataset.enabled !== "true";

                button.dataset.enabled = String(enabled);

                button.classList.toggle(
                    "active",
                    enabled
                );

                showToast(
                    enabled
                        ? "Sustain on"
                        : "Sustain off"
                );
            }
        );
    }

    function setupMixerControls() {
        $("mixerVolume")?.addEventListener(
            "input",
            updateMasterVolume
        );

        $("muteBtn")?.addEventListener(
            "click",
            () => {
                state.masterMuted = !state.masterMuted;

                if (state.masterMuteGain && state.audioContext) {
                    state.masterMuteGain.gain.setTargetAtTime(
                        state.masterMuted ? 0 : 1,
                        state.audioContext.currentTime,
                        0.02
                    );
                }

                const button = $("muteBtn");

                if (button) {
                    button.textContent = state.masterMuted
                        ? "Unmute Master"
                        : "Mute Master";
                }
            }
        );

        $("analyzeAudioBtn")?.addEventListener(
            "click",
            analyseActiveAudio
        );

        $("mixerTrackVolume")?.addEventListener(
            "input",
            (event) => {
                const track = getActiveTrack();

                if (!track) {
                    return;
                }

                track.volume = clamp(
                    Number(event.target.value) / 100,
                    0,
                    1.5
                );

                applyTrackEffects(track);
            }
        );

        $("mixerPan")?.addEventListener(
            "input",
            (event) => {
                const track = getActiveTrack();

                if (!track) {
                    return;
                }

                track.pan = clamp(
                    Number(event.target.value) / 100,
                    -1,
                    1
                );

                applyTrackEffects(track);
            }
        );

        $("voiceVolume")?.addEventListener(
            "input",
            (event) => {
                const track = state.tracks.find(
                    (item) => item.type === "voice"
                );

                if (!track) {
                    return;
                }

                track.volume = Number(event.target.value) / 100;
                applyTrackEffects(track);
            }
        );

        $("voicePan")?.addEventListener(
            "input",
            (event) => {
                const track = state.tracks.find(
                    (item) => item.type === "voice"
                );

                if (!track) {
                    return;
                }

                track.pan = Number(event.target.value) / 100;
                applyTrackEffects(track);
            }
        );

        $("instrumentMixerVolume")?.addEventListener(
            "input",
            (event) => {
                const track = state.tracks.find(
                    (item) => item.type === "keyboard"
                );

                if (!track) {
                    return;
                }

                track.volume =
                    Number(event.target.value) / 100;

                applyTrackEffects(track);
            }
        );

        $("instrumentMixerPan")?.addEventListener(
            "input",
            (event) => {
                const track = state.tracks.find(
                    (item) => item.type === "keyboard"
                );

                if (!track) {
                    return;
                }

                track.pan =
                    Number(event.target.value) / 100;

                applyTrackEffects(track);
            }
        );
    }

    function setupExportControls() {
        $("exportBtn")?.addEventListener(
            "click",
            exportAudio
        );

        $("downloadExportBtn")?.addEventListener(
            "click",
            downloadExport
        );

        [
            "exportFormat",
            "exportQuality",
            "exportSampleRate",
            "exportChannels",
            "exportSource",
            "normalizeExport"
        ].forEach((id) => {
            $(id)?.addEventListener(
                "change",
                updateExportSummary
            );
        });
    }

    function setupProjectControls() {
        $("saveProjectBtn")?.addEventListener(
            "click",
            saveProjectState
        );

        $("backupProjectBtn")?.addEventListener(
            "click",
            backupProject
        );

        $("restoreProjectInput")?.addEventListener(
            "change",
            (event) => {
                restoreProjectFile(
                    event.target.files?.[0]
                );

                event.target.value = "";
            }
        );

        $("undoBtn")?.addEventListener(
            "click",
            undo
        );

        $("redoBtn")?.addEventListener(
            "click",
            redo
        );

        $("projectName")?.addEventListener(
            "input",
            (event) => {
                state.projectName = event.target.value;

                safeText(
                    $("projectState"),
                    "Unsaved changes"
                );
            }
        );
    }

    /* =====================================================
       19. KEYBOARD SHORTCUTS
       ===================================================== */

    function setupKeyboardShortcuts() {
        document.addEventListener("keydown", (event) => {
            const target = event.target;

            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement ||
                target?.isContentEditable
            ) {
                return;
            }

            if (event.code === "Space") {
                event.preventDefault();
                togglePlayback();
            }

            if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "s"
            ) {
                event.preventDefault();
                saveProjectState();
            }

            if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "z"
            ) {
                event.preventDefault();
                undo();
            }

            if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "y"
            ) {
                event.preventDefault();
                redo();
            }

            if (event.key === "Escape") {
                stopPlayback();
            }
        });
    }

    /* =====================================================
       20. APP INITIALIZATION
       ===================================================== */

    function initializeButtonStates() {
        setButtonEnabled("pauseRecordBtn", false);
        setButtonEnabled("resumeRecordBtn", false);
        setButtonEnabled("stopRecordBtn", false);

        setButtonEnabled("pauseKeyboardBtn", false);
        setButtonEnabled("resumeKeyboardBtn", false);
        setButtonEnabled("stopKeyboardBtn", false);

        setButtonEnabled("downloadExportBtn", false);
        setButtonEnabled("undoBtn", false);
        setButtonEnabled("redoBtn", false);

        const result = $("recordingResult");

        if (result) {
            result.hidden = true;
        }

        safeText($("recordingTimer"), "00:00.00");
        safeText($("timeDisplay"), "00:00.00");
        safeText($("durationDisplay"), "00:00.00");

        safeText($("engineStatus"), "Audio engine ready");
        safeText($("engineFooterStatus"), "Ready");
        safeText($("audioStatus"), "Ready");
    }

    function initializeApp() {
        initializeButtonStates();

        setupNavigation();
        setupDropZone();
        setupTrackActions();
        setupControlListeners();
        setupPlaybackControls();
        setupVoiceControls();
        setupKeyboardControls();
        setupMixerControls();
        setupExportControls();
        setupProjectControls();
        setupKeyboardShortcuts();

        buildKeyboard();
        renderTrackList();
        renderTimeline();
        updateExportSummary();

        const canvas = $("recordingWaveform");

        if (canvas) {
            drawWaveform(canvas, null);
        }

        window.addEventListener("resize", () => {
            renderTimeline();
        });

        window.addEventListener("beforeunload", () => {
            if (state.mediaStream) {
                state.mediaStream.getTracks().forEach(
                    (track) => track.stop()
                );
            }

            stopTrackSources();

            if (state.recordingUrl) {
                URL.revokeObjectURL(state.recordingUrl);
            }

            if (state.exportUrl) {
                URL.revokeObjectURL(state.exportUrl);
            }
        });

        console.info(
            "Naol Music Studio 3D initialized."
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initializeApp,
            { once: true }
        );
    } else {
        initializeApp();
    }
})();
