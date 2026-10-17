"use strict";

/* ============================================================
   NAOL MUSIC STUDIO 3D
   Browser-based multitrack audio workstation
   No API key or external JavaScript library required.
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
    /* --------------------------------------------------------
       DOM HELPERS
    -------------------------------------------------------- */

    const $ = (id) => document.getElementById(id);

    const all = (selector, root = document) =>
        Array.from(root.querySelectorAll(selector));

    const clamp = (value, min, max) =>
        Math.max(min, Math.min(max, value));

    const dbToGain = (db) => Math.pow(10, db / 20);

    const safeText = (element, value) => {
        if (element) element.textContent = String(value);
    };

    const setDisabled = (element, disabled) => {
        if (element) element.disabled = Boolean(disabled);
    };

    const formatTime = (seconds) => {
        seconds = Math.max(0, Number(seconds) || 0);

        const minutes = Math.floor(seconds / 60);
        const remainder = Math.floor(seconds % 60);

        return (
            String(minutes).padStart(2, "0") +
            ":" +
            String(remainder).padStart(2, "0")
        );
    };

    const formatLongTime = (seconds) => {
        seconds = Math.max(0, Number(seconds) || 0);

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return (
                String(hours).padStart(2, "0") +
                ":" +
                String(minutes).padStart(2, "0") +
                ":" +
                String(secs).padStart(2, "0")
            );
        }

        return formatTime(seconds);
    };

    const showToast = (message, duration = 3000) => {
        const toast = $("toast");

        if (toast) {
            toast.textContent = message;
            toast.classList.add("show");

            clearTimeout(showToast.timer);

            showToast.timer = setTimeout(() => {
                toast.classList.remove("show");
            }, duration);
        }

        console.log("[Naol Music Studio]", message);
    };

    const setStatus = (id, message) => {
        safeText($(id), message);
    };

    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = filename;
        link.style.display = "none";

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    const cleanFilename = (name) => {
        return String(name || "naol-music-studio")
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 100) || "naol-music-studio";
    };

    /* --------------------------------------------------------
       APPLICATION STATE
    -------------------------------------------------------- */

    const state = {
        audioContext: null,
        masterGain: null,
        masterAnalyser: null,
        masterMeterAnalyser: null,
        masterMute: false,

        tracks: {
            music: {
                name: "Music",
                buffer: null,
                startOffset: 0,
                clipStart: 0,
                clipEnd: null,
                volume: 1,
                pan: 0,
                muted: false,
                solo: false,
                nodes: null,
                source: null,
                sourceStartTime: 0,
                sourceOffset: 0,
                isPlaying: false,
                type: "music"
            },

            voice: {
                name: "Voice",
                buffer: null,
                startOffset: 0,
                clipStart: 0,
                clipEnd: null,
                volume: 1,
                pan: 0,
                muted: false,
                solo: false,
                nodes: null,
                source: null,
                sourceStartTime: 0,
                sourceOffset: 0,
                isPlaying: false,
                type: "voice"
            },

            keyboard: {
                name: "Keyboard",
                buffer: null,
                startOffset: 0,
                clipStart: 0,
                clipEnd: null,
                volume: 1,
                pan: 0,
                muted: false,
                solo: false,
                nodes: null,
                source: null,
                sourceStartTime: 0,
                sourceOffset: 0,
                isPlaying: false,
                type: "keyboard"
            }
        },

        selectedTrack: "music",

        playing: false,
        playbackPosition: 0,
        playbackStartTime: 0,
        playbackStartPosition: 0,
        playbackSpeed: 1,
        playbackTimer: null,

        zoom: 1,

        settings: {
            volume: 100,
            bass: 0,
            mid: 0,
            treble: 0,
            pan: 0,
            reverb: 0,
            delay: 0,
            distortion: 0,
            fadeIn: 0,
            fadeOut: 0
        },

        trackVolumes: {
            music: 100,
            voice: 100,
            keyboard: 100
        },

        trackPans: {
            music: 0,
            voice: 0,
            keyboard: 0
        },

        recording: {
            mediaRecorder: null,
            stream: null,
            chunks: [],
            blob: null,
            url: null,
            startedAt: 0,
            elapsedBeforePause: 0,
            timer: null,
            paused: false,
            audioContextSource: null,
            monitorGain: null,
            monitorAnalyser: null
        },

        keyboardRecording: {
            active: false,
            paused: false,
            startedAt: 0,
            elapsedBeforePause: 0,
            events: [],
            notes: new Map(),
            playbackSources: [],
            buffer: null,
            timer: null
        },

        activeNotes: new Map(),
        sustain: false,

        compareOriginal: false,

        exportBlob: null,
        exportFilename: null,

        history: [],
        historyIndex: -1,
        historyLimit: 30,

        visualizerFrame: null,
        animationFrame: null,

        toastTimer: null
    };

    const PRESETS = {
        clean: {
            bass: 0,
            mid: 0,
            treble: 0,
            reverb: 0,
            delay: 0,
            distortion: 0
        },

        warm: {
            bass: 4,
            mid: 1,
            treble: -3,
            reverb: 12,
            delay: 0,
            distortion: 0
        },

        bright: {
            bass: -2,
            mid: 1,
            treble: 5,
            reverb: 8,
            delay: 0,
            distortion: 0
        },

        rap: {
            bass: 3,
            mid: 3,
            treble: 2,
            reverb: 4,
            delay: 2,
            distortion: 0
        },

        gospel: {
            bass: 2,
            mid: 2,
            treble: 3,
            reverb: 24,
            delay: 6,
            distortion: 0
        },

        studio: {
            bass: 1,
            mid: 1,
            treble: 2,
            reverb: 8,
            delay: 2,
            distortion: 0
        }
    };

    /* --------------------------------------------------------
       AUDIO CONTEXT
    -------------------------------------------------------- */

    const getAudioContext = async () => {
        if (!state.audioContext) {
            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;

            if (!AudioContextClass) {
                throw new Error(
                    "This browser does not support Web Audio. Try an updated Chrome browser."
                );
            }

            state.audioContext = new AudioContextClass();

            state.masterGain =
                state.audioContext.createGain();

            state.masterAnalyser =
                state.audioContext.createAnalyser();

            state.masterMeterAnalyser =
                state.audioContext.createAnalyser();

            state.masterAnalyser.fftSize = 2048;
            state.masterAnalyser.smoothingTimeConstant = 0.8;

            state.masterMeterAnalyser.fftSize = 256;

            state.masterGain.gain.value =
                state.masterMute ? 0 : 1;

            state.masterGain.connect(state.masterAnalyser);
            state.masterAnalyser.connect(
                state.masterMeterAnalyser
            );

            state.masterMeterAnalyser.connect(
                state.audioContext.destination
            );

            safeText($("engineStatus"), "Ready");
            safeText(
                $("engineFooterStatus"),
                "Audio engine initialized"
            );

            startVisualizers();
        }

        if (state.audioContext.state === "suspended") {
            await state.audioContext.resume();
        }

        return state.audioContext;
    };

    /* --------------------------------------------------------
       AUDIO EFFECT NODES
    -------------------------------------------------------- */

    const makeImpulseResponse = (context, seconds = 2.0) => {
        const rate = context.sampleRate;
        const length = Math.floor(rate * seconds);

        const impulse = context.createBuffer(
            2,
            length,
            rate
        );

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);

            for (let i = 0; i < length; i++) {
                const decay = Math.pow(
                    1 - i / length,
                    2.5
                );

                data[i] =
                    (Math.random() * 2 - 1) *
                    decay *
                    0.35;
            }
        }

        return impulse;
    };

    const makeDistortionCurve = (amount) => {
        const samples = 44100;
        const curve = new Float32Array(samples);

        const k = amount * 80;

        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;

            curve[i] =
                k === 0
                    ? x
                    : ((3 + k) * x * 20 * Math.PI / 180) /
                      (Math.PI + k * Math.abs(x));
        }

        return curve;
    };

    const createTrackNodes = async (track) => {
        const context = await getAudioContext();

        if (track.nodes) {
            return track.nodes;
        }

        const input = context.createGain();

        const bass = context.createBiquadFilter();
        bass.type = "lowshelf";
        bass.frequency.value = 180;

        const mid = context.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = 1000;
        mid.Q.value = 0.8;

        const treble = context.createBiquadFilter();
        treble.type = "highshelf";
        treble.frequency.value = 5000;

        const distortion = context.createWaveShaper();
        distortion.oversample = "2x";

        const dryGain = context.createGain();
        const wetGain = context.createGain();

        const convolver = context.createConvolver();
        convolver.buffer = makeImpulseResponse(context);

        const reverbGain = context.createGain();

        const delay = context.createDelay(2.0);
        const delayFeedback = context.createGain();
        const delayWet = context.createGain();

        delay.delayTime.value = 0.28;
        delayFeedback.gain.value = 0.22;

        const pan = context.createStereoPanner
            ? context.createStereoPanner()
            : context.createGain();

        const trackGain = context.createGain();

        const outputAnalyser = context.createAnalyser();
        outputAnalyser.fftSize = 256;

        input.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(distortion);

        distortion.connect(dryGain);
        dryGain.connect(pan);

        distortion.connect(convolver);
        convolver.connect(reverbGain);
        reverbGain.connect(pan);

        distortion.connect(delay);
        delay.connect(delayFeedback);
        delayFeedback.connect(delay);
        delay.connect(delayWet);
        delayWet.connect(pan);

        pan.connect(trackGain);
        trackGain.connect(outputAnalyser);
        outputAnalyser.connect(state.masterGain);

        track.nodes = {
            input,
            bass,
            mid,
            treble,
            distortion,
            dryGain,
            convolver,
            reverbGain,
            delay,
            delayFeedback,
            delayWet,
            pan,
            trackGain,
            outputAnalyser
        };

        updateTrackEffects(track);

        return track.nodes;
    };

    const isTrackAudible = (track) => {
        const allTracks = Object.values(state.tracks);
        const anySolo = allTracks.some((item) => item.solo);

        if (track.muted) return false;
        if (anySolo && !track.solo) return false;

        return true;
    };

    const updateTrackGain = (track) => {
        if (!track.nodes || !state.audioContext) return;

        const settingsVolume =
            track.type === "music"
                ? Number(state.settings.volume) / 100
                : 1;

        const mixerVolume =
            Number(state.trackVolumes[track.type] ?? 100) / 100;

        const muteMultiplier =
            isTrackAudible(track) ? 1 : 0;

        const master =
            state.masterMute ? 0 : 1;

        const gain =
            settingsVolume *
            mixerVolume *
            Number(track.volume ?? 1) *
            muteMultiplier *
            master;

        track.nodes.trackGain.gain.setTargetAtTime(
            gain,
            state.audioContext.currentTime,
            0.015
        );

        const panValue =
            Number(state.trackPans[track.type] ?? 0);

        const settingsPan =
            track.type === "music"
                ? Number(state.settings.pan)
                : 0;

        const combinedPan = clamp(
            (panValue + settingsPan) / 100,
            -1,
            1
        );

        if ("pan" in track.nodes.pan) {
            track.nodes.pan.pan.setTargetAtTime(
                combinedPan,
                state.audioContext.currentTime,
                0.015
            );
        }

        if (track.nodes.pan.gain) {
            track.nodes.pan.gain.value = 1;
        }
    };

    const updateTrackEffects = (track) => {
        if (!track.nodes || !state.audioContext) return;

        const n = track.nodes;
        const now = state.audioContext.currentTime;
        const s = state.settings;

        n.bass.gain.setTargetAtTime(
            Number(s.bass),
            now,
            0.02
        );

        n.mid.gain.setTargetAtTime(
            Number(s.mid),
            now,
            0.02
        );

        n.treble.gain.setTargetAtTime(
            Number(s.treble),
            now,
            0.02
        );

        const distortionAmount =
            clamp(Number(s.distortion) / 100, 0, 1);

        n.distortion.curve =
            distortionAmount > 0
                ? makeDistortionCurve(distortionAmount)
                : null;

        n.dryGain.gain.setTargetAtTime(
            1 - distortionAmount * 0.18,
            now,
            0.02
        );

        n.reverbGain.gain.setTargetAtTime(
            Number(s.reverb) / 100,
            now,
            0.03
        );

        n.delayWet.gain.setTargetAtTime(
            Number(s.delay) / 100 * 0.65,
            now,
            0.03
        );

        n.delayFeedback.gain.setTargetAtTime(
            clamp(Number(s.delay) / 100 * 0.55, 0, 0.55),
            now,
            0.03
        );

        updateTrackGain(track);
    };

    const updateAllTrackNodes = () => {
        Object.values(state.tracks).forEach((track) => {
            updateTrackEffects(track);
        });
    };

    /* --------------------------------------------------------
       TRACK AND TIMELINE HELPERS
    -------------------------------------------------------- */

    const getTrackDuration = (track) => {
        if (!track.buffer) return 0;

        const clipStart = Number(track.clipStart || 0);

        const clipEnd =
            track.clipEnd == null
                ? track.buffer.duration
                : Math.min(
                    Number(track.clipEnd),
                    track.buffer.duration
                );

        return Math.max(0, clipEnd - clipStart);
    };

    const getProjectDuration = () => {
        let maxEnd = 0;

        Object.values(state.tracks).forEach((track) => {
            if (!track.buffer) return;

            const end =
                Number(track.startOffset || 0) +
                getTrackDuration(track);

            maxEnd = Math.max(maxEnd, end);
        });

        return maxEnd;
    };

    const getSelectedTrack = () =>
        state.tracks[state.selectedTrack];

    const updateSelectedTrackInfo = () => {
        const track = getSelectedTrack();

        if (!track || !track.buffer) {
            safeText($("currentTrackTitle"), "No audio selected");
            safeText(
                $("audioFormat"),
                "Import an audio file to begin."
            );
            safeText($("trackDurationText"), "00:00");
            safeText($("durationDisplay"), "00:00");
            safeText($("audioStatus"), "No file");
            return;
        }

        const duration = getTrackDuration(track);

        safeText($("currentTrackTitle"), track.name);
        safeText(
            $("audioFormat"),
            `${track.buffer.sampleRate} Hz · ${track.buffer.numberOfChannels} channel(s)`
        );

        safeText($("trackDurationText"), formatTime(duration));
        safeText($("durationDisplay"), formatTime(getProjectDuration()));
        safeText($("audioStatus"), track.name);
    };

    const updateTrackCount = () => {
        const count = Object.values(state.tracks)
            .filter((track) => Boolean(track.buffer))
            .length;

        safeText($("trackCount"), count);
    };

    const setSelectedTrack = (type) => {
        if (!state.tracks[type]) return;

        state.selectedTrack = type;

        updateSelectedTrackInfo();
        drawWaveform();
        updateTimeline();

        const track = state.tracks[type];

        if (track.buffer) {
            safeText(
                $("timelineHelp"),
                `${track.name} selected. Use the transport controls to play the project.`
            );
        }
    };

    const drawCanvasWaveform = (
        canvas,
        buffer,
        color = "#64e8ff"
    ) => {
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;

        const width = Math.max(
            1,
            Math.floor(rect.width || canvas.clientWidth || 500)
        );

        const height = Math.max(
            1,
            Math.floor(rect.height || canvas.clientHeight || 80)
        );

        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);

        const context = canvas.getContext("2d");

        if (!context) return;

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);

        context.fillStyle = "rgba(9, 15, 30, 0.16)";
        context.fillRect(0, 0, width, height);

        context.strokeStyle = "rgba(255,255,255,0.10)";
        context.beginPath();
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();

        if (!buffer) {
            return;
        }

        const data = buffer.getChannelData(0);
        const step = Math.max(
            1,
            Math.floor(data.length / width)
        );

        context.strokeStyle = color;
        context.lineWidth = 1;

        context.beginPath();

        for (let x = 0; x < width; x++) {
            const start = x * step;
            const end = Math.min(start + step, data.length);

            let min = 1;
            let max = -1;

            for (let i = start; i < end; i++) {
                const sample = data[i];

                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }

            const y1 = (1 - max) * height / 2;
            const y2 = (1 - min) * height / 2;

            context.moveTo(x, y1);
            context.lineTo(x, y2);
        }

        context.stroke();
    };

    const drawWaveform = () => {
        const track = getSelectedTrack();

        drawCanvasWaveform(
            $("waveformCanvas"),
            track ? track.buffer : null
        );

        if ($("emptyWaveform")) {
            $("emptyWaveform").style.display =
                track && track.buffer ? "none" : "";
        }
    };

    const updateTimeline = () => {
        const projectDuration = Math.max(
            10,
            getProjectDuration(),
            10
        );

        const pixelsPerSecond = 60 * state.zoom;
        const contentWidth = Math.max(
            700,
            projectDuration * pixelsPerSecond + 120
        );

        const timelineContent = $("timelineContent");

        if (timelineContent) {
            timelineContent.style.width = `${contentWidth}px`;
        }

        const ruler = $("timelineRuler");

        if (ruler) {
            ruler.innerHTML = "";

            const step = state.zoom >= 2 ? 5 : 10;

            for (let seconds = 0; seconds <= projectDuration; seconds += step) {
                const mark = document.createElement("span");

                mark.textContent = formatTime(seconds);
                mark.style.position = "absolute";
                mark.style.left =
                    `${seconds * pixelsPerSecond}px`;

                ruler.appendChild(mark);
            }
        }

        const clipIds = {
            music: "mainAudioClip",
            voice: "voiceAudioClip",
            keyboard: "keyboardAudioClip"
        };

        Object.entries(clipIds).forEach(([type, id]) => {
            const track = state.tracks[type];
            const clip = $(id);

            if (!clip) return;

            const lane = clip.closest(".timeline-track-lane");

            if (lane) {
                lane.style.position = "relative";
                lane.style.minWidth = `${contentWidth}px`;
            }

            if (!track.buffer) {
                clip.style.width = "auto";
                clip.style.left = "0";
                clip.style.minWidth = "120px";

                if (type === "music") {
                    safeText(
                        $("timelineTrackName"),
                        "Music Audio"
                    );
                } else if (type === "voice") {
                    clip.textContent = "Voice recording appears here";
                } else {
                    clip.textContent =
                        "Keyboard performance appears here";
                }

                return;
            }

            const left =
                Number(track.startOffset || 0) *
                pixelsPerSecond;

            const width = Math.max(
                45,
                getTrackDuration(track) * pixelsPerSecond
            );

            clip.style.position = "absolute";
            clip.style.left = `${left}px`;
            clip.style.width = `${width}px`;
            clip.style.minWidth = "45px";
            clip.style.overflow = "hidden";

            if (type === "music") {
                safeText(
                    $("timelineTrackName"),
                    track.name
                );
            } else {
                clip.textContent = track.name;
            }
        });

        const playhead = $("playhead");

        if (playhead) {
            playhead.style.left =
                `${state.playbackPosition * pixelsPerSecond}px`;
        }

        safeText($("zoomValue"), `${Math.round(state.zoom * 100)}%`);

        updateTrackCount();
    };

    const renderTrackLibrary = () => {
        const list = $("trackList");

        if (!list) return;

        list.innerHTML = "";

        const colors = {
            music: "music-color",
            voice: "voice-color",
            keyboard: "keyboard-color"
        };

        Object.entries(state.tracks).forEach(([type, track]) => {
            const row = document.createElement("button");

            row.type = "button";
            row.className = "library-track";
            row.style.width = "100%";
            row.style.textAlign = "left";
            row.style.border = "0";
            row.style.cursor = "pointer";

            const color = document.createElement("span");
            color.className = `track-color ${colors[type]}`;

            const info = document.createElement("div");

            const title = document.createElement("strong");
            title.textContent = track.name;

            const subtitle = document.createElement("small");
            subtitle.textContent = track.buffer
                ? formatTime(getTrackDuration(track))
                : "Empty track";

            info.append(title, subtitle);
            row.append(color, info);

            row.addEventListener("click", () => {
                setSelectedTrack(type);
            });

            list.appendChild(row);
        });
    };

    /* --------------------------------------------------------
       PROJECT HISTORY
    -------------------------------------------------------- */

    const captureProjectState = () => {
        const tracks = {};

        Object.entries(state.tracks).forEach(([type, track]) => {
            tracks[type] = {
                name: track.name,
                startOffset: track.startOffset,
                clipStart: track.clipStart,
                clipEnd: track.clipEnd,
                volume: track.volume,
                pan: track.pan,
                muted: track.muted,
                solo: track.solo
            };
        });

        return {
            projectName: $("projectName")?.value || "My Music Project",
            selectedTrack: state.selectedTrack,
            settings: { ...state.settings },
            trackVolumes: { ...state.trackVolumes },
            trackPans: { ...state.trackPans },
            tracks
        };
    };

    const saveHistory = () => {
        const snapshot = captureProjectState();

        state.history = state.history.slice(
            0,
            state.historyIndex + 1
        );

        state.history.push(snapshot);

        if (state.history.length > state.historyLimit) {
            state.history.shift();
        }

        state.historyIndex = state.history.length - 1;

        setDisabled($("undoBtn"), state.historyIndex <= 0);
        setDisabled(
            $("redoBtn"),
            state.historyIndex >= state.history.length - 1
        );

        safeText($("projectState"), "Modified");
    };

    const applyHistorySnapshot = (snapshot) => {
        if (!snapshot) return;

        if ($("projectName")) {
            $("projectName").value =
                snapshot.projectName || "My Music Project";
        }

        state.selectedTrack =
            state.tracks[snapshot.selectedTrack]
                ? snapshot.selectedTrack
                : "music";

        Object.assign(state.settings, snapshot.settings || {});
        Object.assign(
            state.trackVolumes,
            snapshot.trackVolumes || {}
        );

        Object.assign(state.trackPans, snapshot.trackPans || {});

        Object.entries(snapshot.tracks || {}).forEach(
            ([type, saved]) => {
                const track = state.tracks[type];

                if (!track) return;

                track.name = saved.name || track.name;
                track.startOffset = Number(saved.startOffset || 0);
                track.clipStart = Number(saved.clipStart || 0);

                track.clipEnd =
                    saved.clipEnd == null
                        ? null
                        : Number(saved.clipEnd);

                track.volume = Number(saved.volume ?? 1);
                track.pan = Number(saved.pan ?? 0);
                track.muted = Boolean(saved.muted);
                track.solo = Boolean(saved.solo);
            }
        );

        syncControlsFromState();
        updateAllTrackNodes();
        renderTrackLibrary();
        updateTimeline();
        updateSelectedTrackInfo();
        drawWaveform();
    };

    const moveHistory = (direction) => {
        const next = state.historyIndex + direction;

        if (next < 0 || next >= state.history.length) {
            return;
        }

        state.historyIndex = next;

        applyHistorySnapshot(state.history[next]);

        setDisabled($("undoBtn"), state.historyIndex <= 0);
        setDisabled(
            $("redoBtn"),
            state.historyIndex >= state.history.length - 1
        );

        showToast(direction < 0 ? "Undo complete." : "Redo complete.");
    };

    /* --------------------------------------------------------
       LOAD AUDIO
    -------------------------------------------------------- */

    const loadAudioFile = async (file, preferredType) => {
        if (!file) return;

        if (
            !file.type.startsWith("audio/") &&
            !/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)
        ) {
            showToast(`Unsupported file: ${file.name}`);
            return;
        }

        try {
            const context = await getAudioContext();

            safeText($("engineStatus"), "Loading");
            safeText($("audioStatus"), file.name);
            showToast(`Loading ${file.name}...`);

            const arrayBuffer = await file.arrayBuffer();

            let decoded;

            try {
                decoded = await context.decodeAudioData(
                    arrayBuffer.slice(0)
                );
            } catch (error) {
                throw new Error(
                    "The browser could not decode this audio file. Try WAV, MP3 or OGG."
                );
            }

            let type = preferredType || state.selectedTrack;

            if (!state.tracks[type]) type = "music";

            /*
             * When importing several files, use the next available
             * empty track. Extra imported files replace music because
             * this project template contains three built-in tracks.
             */
            const target = state.tracks[type];

            stopPlayback();

            target.buffer = decoded;
            target.name = file.name;
            target.startOffset = 0;
            target.clipStart = 0;
            target.clipEnd = decoded.duration;
            target.isPlaying = false;

            target.nodes = null;

            await createTrackNodes(target);

            state.selectedTrack = type;
            state.playbackPosition = 0;

            updateAllTrackNodes();
            updateSelectedTrackInfo();
            drawWaveform();
            updateTimeline();
            renderTrackLibrary();

            safeText($("engineStatus"), "Ready");
            safeText($("audioStatus"), file.name);
            safeText(
                $("timelineHelp"),
                `${file.name} loaded successfully.`
            );

            setStatus(
                "analysisStatus",
                "Audio loaded. Select Analyze Audio to inspect it."
            );

            updateExportSummary();
            saveHistory();

            showToast("Audio imported successfully.");
        } catch (error) {
            console.error(error);

            safeText($("engineStatus"), "Error");
            showToast(error.message || "Audio import failed.");
        }
    };

    const importFiles = async (files) => {
        const fileArray = Array.from(files || []);

        if (!fileArray.length) return;

        for (let i = 0; i < fileArray.length; i++) {
            let target = state.selectedTrack;

            if (i > 0) {
                const empty = Object.entries(state.tracks)
                    .find(([, track]) => !track.buffer);

                target = empty ? empty[0] : "music";
            }

            await loadAudioFile(fileArray[i], target);
        }
    };

    const audioUpload = $("audioUpload");

    if (audioUpload) {
        audioUpload.addEventListener("change", async (event) => {
            await importFiles(event.target.files);
            event.target.value = "";
        });
    }

    const dropZone = $("uploadDropZone");

    if (dropZone) {
        dropZone.addEventListener("dragover", (event) => {
            event.preventDefault();
            dropZone.classList.add("drag-over");
        });

        dropZone.addEventListener("dragleave", () => {
            dropZone.classList.remove("drag-over");
        });

        dropZone.addEventListener("drop", async (event) => {
            event.preventDefault();
            dropZone.classList.remove("drag-over");

            const files = Array.from(event.dataTransfer?.files || [])
                .filter((file) =>
                    file.type.startsWith("audio/") ||
                    /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)
                );

            await importFiles(files);
        });
    }

    const addTrackBtn = $("addTrackBtn");

    if (addTrackBtn) {
        addTrackBtn.addEventListener("click", () => {
            if (audioUpload) audioUpload.click();
        });
    }

    /* --------------------------------------------------------
       PLAYBACK ENGINE
    -------------------------------------------------------- */

    const stopTrackSource = (track) => {
        if (track.source) {
            try {
                track.source.onended = null;
                track.source.stop();
            } catch (_) {
                // The source may already have stopped.
            }

            try {
                track.source.disconnect();
            } catch (_) {
                // The source may already be disconnected.
            }
        }

        track.source = null;
        track.isPlaying = false;
    };

    const getCurrentPosition = () => {
        if (!state.playing || !state.audioContext) {
            return state.playbackPosition;
        }

        const elapsed =
            (state.audioContext.currentTime -
                state.playbackStartTime) *
            state.playbackSpeed;

        return clamp(
            state.playbackStartPosition + elapsed,
            0,
            getProjectDuration()
        );
    };

    const startTrackSource = async (track, projectPosition) => {
        if (!track.buffer) return;

        const context = await getAudioContext();
        await createTrackNodes(track);

        const trackStart = Number(track.startOffset || 0);

        if (projectPosition >= trackStart + getTrackDuration(track)) {
            return;
        }

        const withinTrack = Math.max(
            0,
            projectPosition - trackStart
        );

        const sourceOffset =
            Number(track.clipStart || 0) + withinTrack;

        const clipEnd =
            track.clipEnd == null
                ? track.buffer.duration
                : Math.min(track.clipEnd, track.buffer.duration);

        if (sourceOffset >= clipEnd) return;

        const source = context.createBufferSource();

        source.buffer = track.buffer;
        source.playbackRate.value = state.playbackSpeed;

        source.connect(track.nodes.input);

        track.source = source;
        track.sourceStartTime = context.currentTime;
        track.sourceOffset = sourceOffset;
        track.isPlaying = true;

        updateTrackEffects(track);

        const availableDuration =
            (clipEnd - sourceOffset) / state.playbackSpeed;

        source.onended = () => {
            if (track.source === source) {
                track.source = null;
                track.isPlaying = false;
            }
        };

        source.start(
            0,
            sourceOffset,
            Math.max(0.001, clipEnd - sourceOffset)
        );

        if (availableDuration <= 0) {
            stopTrackSource(track);
        }
    };

    const startPlayback = async (position = state.playbackPosition) => {
        try {
            const duration = getProjectDuration();

            if (!duration) {
                showToast("Import audio or add a recording first.");
                return;
            }

            await getAudioContext();

            stopPlayback(false);

            state.playbackPosition = clamp(position, 0, duration);
            state.playbackStartPosition = state.playbackPosition;
            state.playbackStartTime =
                state.audioContext.currentTime;
            state.playing = true;

            const tasks = Object.values(state.tracks).map(
                (track) => startTrackSource(
                    track,
                    state.playbackPosition
                )
            );

            await Promise.all(tasks);

            safeText($("playBtn"), "Ⅱ");
            safeText($("playbackBadge"), "PLAYING");
            safeText($("engineStatus"), "Playing");
            safeText(
                $("engineFooterStatus"),
                "Audio playback active"
            );

            clearInterval(state.playbackTimer);

            state.playbackTimer = setInterval(() => {
                if (!state.playing) return;

                const current = getCurrentPosition();

                state.playbackPosition = current;

                const seek = $("seekBar");

                if (seek) {
                    seek.value = String(
                        getProjectDuration()
                            ? current / getProjectDuration() * 100
                            : 0
                    );
                }

                safeText($("timeDisplay"), formatTime(current));

                const playhead = $("playhead");

                if (playhead) {
                    playhead.style.left =
                        `${current * 60 * state.zoom}px`;
                }

                if (current >= getProjectDuration()) {
                    stopPlayback();
                }
            }, 50);
        } catch (error) {
            console.error(error);
            showToast(error.message || "Playback could not start.");
        }
    };

    function stopPlayback(resetPosition = false) {
        if (state.playing && state.audioContext) {
            state.playbackPosition = getCurrentPosition();
        }

        state.playing = false;

        clearInterval(state.playbackTimer);
        state.playbackTimer = null;

        Object.values(state.tracks).forEach((track) => {
            stopTrackSource(track);
        });

        safeText($("playBtn"), "▶");
        safeText($("playbackBadge"), "STOPPED");

        if (resetPosition) {
            state.playbackPosition = 0;
        }

        const seek = $("seekBar");

        if (seek) {
            seek.value = String(
                getProjectDuration()
                    ? state.playbackPosition /
                      getProjectDuration() * 100
                    : 0
            );
        }

        safeText(
            $("timeDisplay"),
            formatTime(state.playbackPosition)
        );

        safeText($("engineStatus"), "Ready");

        updateTimeline();
    }

    const playBtn = $("playBtn");

    if (playBtn) {
        playBtn.addEventListener("click", async () => {
            if (state.playing) {
                const position = getCurrentPosition();

                stopPlayback(false);
                state.playbackPosition = position;

                safeText($("playbackBadge"), "PAUSED");
                safeText($("timeDisplay"), formatTime(position));
            } else {
                await startPlayback(state.playbackPosition);
            }
        });
    }

    $("stopBtn")?.addEventListener("click", () => {
        stopPlayback(true);
        showToast("Playback stopped.");
    });

    $("restartBtn")?.addEventListener("click", async () => {
        state.playbackPosition = 0;
        await startPlayback(0);
    });

    $("seekBar")?.addEventListener("input", async (event) => {
        const percent = Number(event.target.value) / 100;

        const target = percent * getProjectDuration();

        if (state.playing) {
            await startPlayback(target);
        } else {
            state.playbackPosition = target;
            safeText($("timeDisplay"), formatTime(target));
            updateTimeline();
        }
    });

    $("playbackSpeed")?.addEventListener("change", async (event) => {
        const position = state.playing
            ? getCurrentPosition()
            : state.playbackPosition;

        state.playbackSpeed = clamp(
            Number(event.target.value) || 1,
            0.25,
            4
        );

        if (state.playing) {
            await startPlayback(position);
        }
    });

    /* --------------------------------------------------------
       EDITING TOOLS
    -------------------------------------------------------- */

    $("zoomInBtn")?.addEventListener("click", () => {
        state.zoom = clamp(state.zoom * 1.25, 0.25, 8);
        updateTimeline();
    });

    $("zoomOutBtn")?.addEventListener("click", () => {
        state.zoom = clamp(state.zoom / 1.25, 0.25, 8);
        updateTimeline();
    });

    $("fitTimelineBtn")?.addEventListener("click", () => {
        const duration = Math.max(10, getProjectDuration());
        const scroll = $("timelineScroll");

        if (scroll) {
            state.zoom = clamp(
                (scroll.clientWidth - 100) / (duration * 60),
                0.25,
                8
            );
        } else {
            state.zoom = 1;
        }

        updateTimeline();
    });

    const splitBuffer = (buffer, splitSeconds) => {
        const context = state.audioContext;

        if (!context || !buffer) return null;

        const splitFrame = clamp(
            Math.floor(splitSeconds * buffer.sampleRate),
            1,
            buffer.length - 1
        );

        const firstLength = splitFrame;
        const secondLength = buffer.length - splitFrame;

        if (firstLength < 1 || secondLength < 1) {
            return null;
        }

        const first = context.createBuffer(
            buffer.numberOfChannels,
            firstLength,
            buffer.sampleRate
        );

        const second = context.createBuffer(
            buffer.numberOfChannels,
            secondLength,
            buffer.sampleRate
        );

        for (
            let channel = 0;
            channel < buffer.numberOfChannels;
            channel++
        ) {
            const sourceData = buffer.getChannelData(channel);

            first.copyToChannel(
                sourceData.slice(0, firstLength),
                channel
            );

            second.copyToChannel(
                sourceData.slice(splitFrame),
                channel
            );
        }

        return { first, second };
    };

    $("splitBtn")?.addEventListener("click", async () => {
        const track = getSelectedTrack();

        if (!track || !track.buffer) {
            showToast("Select a track containing audio first.");
            return;
        }

        const position = getCurrentPosition();

        const localPosition = clamp(
            position - track.startOffset,
            0,
            getTrackDuration(track)
        );

        const splitAt = track.clipStart + localPosition;

        const parts = splitBuffer(track.buffer, splitAt);

        if (!parts) {
            showToast("Move the playhead away from the clip edges.");
            return;
        }

        stopPlayback();

        const originalName = track.name;

        track.buffer = parts.first;
        track.clipStart = 0;
        track.clipEnd = parts.first.duration;
        track.startOffset = 0;
        track.name = `${originalName} (Part 1)`;
        track.nodes = null;

        const other = Object.values(state.tracks).find(
            (candidate) =>
                candidate !== track && !candidate.buffer
        );

        if (other) {
            other.buffer = parts.second;
            other.name = `${originalName} (Part 2)`;
            other.clipStart = 0;
            other.clipEnd = parts.second.duration;
            other.startOffset = localPosition;
            other.nodes = null;
        } else {
            showToast(
                "Split created the first segment, but no empty track was available for the second segment."
            );
        }

        await createTrackNodes(track);

        if (other && other.buffer) {
            await createTrackNodes(other);
        }

        renderTrackLibrary();
        updateSelectedTrackInfo();
        drawWaveform();
        updateTimeline();
        saveHistory();

        showToast("Split operation completed.");
    });

    $("trimStartBtn")?.addEventListener("click", async () => {
        const track = getSelectedTrack();

        if (!track || !track.buffer) {
            showToast("Import audio before trimming.");
            return;
        }

        const position = getCurrentPosition();

        const local = position - track.startOffset;

        if (local <= 0 || local >= getTrackDuration(track)) {
            showToast("Move the playhead inside the selected clip.");
            return;
        }

        const trimPoint = track.clipStart + local;

        const buffer = state.audioContext
            ? state.audioContext.createBuffer(
                track.buffer.numberOfChannels,
                Math.floor(
                    (track.clipEnd - trimPoint) *
                    track.buffer.sampleRate
                ),
                track.buffer.sampleRate
            )
            : null;

        if (!buffer || buffer.length < 1) {
            showToast("Unable to trim at this position.");
            return;
        }

        for (
            let channel = 0;
            channel < track.buffer.numberOfChannels;
            channel++
        ) {
            buffer.copyToChannel(
                track.buffer
                    .getChannelData(channel)
                    .slice(
                        Math.floor(
                            trimPoint * track.buffer.sampleRate
                        )
                    ),
                channel
            );
        }

        stopPlayback();

        track.buffer = buffer;
        track.clipStart = 0;
        track.clipEnd = buffer.duration;
        track.startOffset = 0;
        track.nodes = null;

        await createTrackNodes(track);

        updateSelectedTrackInfo();
        drawWaveform();
        updateTimeline();
        renderTrackLibrary();
        saveHistory();

        showToast("Trim Start applied.");
    });

    $("trimEndBtn")?.addEventListener("click", async () => {
        const track = getSelectedTrack();

        if (!track || !track.buffer) {
            showToast("Import audio before trimming.");
            return;
        }

        const position = getCurrentPosition();

        const local = position - track.startOffset;

        if (local <= 0 || local >= getTrackDuration(track)) {
            showToast("Move the playhead inside the selected clip.");
            return;
        }

        const endPoint = track.clipStart + local;

        const frameCount = Math.floor(
            endPoint * track.buffer.sampleRate
        );

        if (frameCount < 1) {
            showToast("Trim position is too close to the beginning.");
            return;
        }

        const buffer = state.audioContext.createBuffer(
            track.buffer.numberOfChannels,
            frameCount,
            track.buffer.sampleRate
        );

        for (
            let channel = 0;
            channel < track.buffer.numberOfChannels;
            channel++
        ) {
            buffer.copyToChannel(
                track.buffer
                    .getChannelData(channel)
                    .slice(0, frameCount),
                channel
            );
        }

        stopPlayback();

        track.buffer = buffer;
        track.clipStart = 0;
        track.clipEnd = buffer.duration;
        track.startOffset = 0;
        track.nodes = null;

        await createTrackNodes(track);

        updateSelectedTrackInfo();
        drawWaveform();
        updateTimeline();
        renderTrackLibrary();
        saveHistory();

        showToast("Trim End applied.");
    });

    $("deleteAudioBtn")?.addEventListener("click", () => {
        const track = getSelectedTrack();

        if (!track || !track.buffer) {
            showToast("There is no audio in the selected track.");
            return;
        }

        stopPlayback();

        track.buffer = null;
        track.name =
            track.type.charAt(0).toUpperCase() +
            track.type.slice(1);

        track.startOffset = 0;
        track.clipStart = 0;
        track.clipEnd = null;
        track.nodes = null;

        state.playbackPosition = 0;

        updateSelectedTrackInfo();
        drawWaveform();
        updateTimeline();
        renderTrackLibrary();
        updateExportSummary();
        saveHistory();

        showToast("Selected track cleared.");
    });

    /* --------------------------------------------------------
       ADJUSTMENT CONTROLS
    -------------------------------------------------------- */

    const CONTROL_MAP = {
        volumeControl: ["volume", "volumeValue", "%"],
        bassControl: ["bass", "bassValue", " dB"],
        midControl: ["mid", "midValue", " dB"],
        trebleControl: ["treble", "trebleValue", " dB"],
        panControl: ["pan", "panValue", ""],
        reverbControl: ["reverb", "reverbValue", "%"],
        delayControl: ["delay", "delayValue", "%"],
        distortionControl: [
            "distortion",
            "distortionValue",
            "%"
        ],
        fadeInControl: ["fadeIn", "fadeInValue", " sec"],
        fadeOutControl: ["fadeOut", "fadeOutValue", " sec"]
    };

    const getControlLabel = (key, value, suffix) => {
        if (key === "pan") {
            if (value < 0) return `L ${Math.abs(value)}%`;
            if (value > 0) return `R ${value}%`;
            return "Center";
        }

        return `${value}${suffix}`;
    };

    const syncControlsFromState = () => {
        Object.entries(CONTROL_MAP).forEach(
            ([id, [key, labelId, suffix]]) => {
                const control = $(id);

                if (!control) return;

                control.value = state.settings[key];

                safeText(
                    $(labelId),
                    getControlLabel(
                        key,
                        state.settings[key],
                        suffix
                    )
                );
            }
        );

        if ($("mixerTrackVolume")) {
            $("mixerTrackVolume").value =
                state.trackVolumes.music;
        }

        if ($("voiceVolume")) {
            $("voiceVolume").value =
                state.trackVolumes.voice;
        }

        if ($("instrumentMixerVolume")) {
            $("instrumentMixerVolume").value =
                state.trackVolumes.keyboard;
        }

        if ($("mixerPan")) {
            $("mixerPan").value =
                state.trackPans.music;
        }

        if ($("voicePan")) {
            $("voicePan").value =
                state.trackPans.voice;
        }

        if ($("instrumentMixerPan")) {
            $("instrumentMixerPan").value =
                state.trackPans.keyboard;
        }

        updateMixerLabels();
    };

    Object.entries(CONTROL_MAP).forEach(
        ([id, [key, labelId, suffix]]) => {
            const control = $(id);

            if (!control) return;

            control.addEventListener("input", () => {
                state.settings[key] = Number(control.value);

                safeText(
                    $(labelId),
                    getControlLabel(
                        key,
                        state.settings[key],
                        suffix
                    )
                );

                updateAllTrackNodes();

                if (key === "volume") {
                    updateMixerLabels();
                }
            });

            control.addEventListener("change", () => {
                saveHistory();
            });
        }
    );

    $("resetAdjustmentsBtn")?.addEventListener(
        "click",
        () => {
            Object.assign(state.settings, {
                volume: 100,
                bass: 0,
                mid: 0,
                treble: 0,
                pan: 0,
                reverb: 0,
                delay: 0,
                distortion: 0,
                fadeIn: 0,
                fadeOut: 0
            });

            syncControlsFromState();
            updateAllTrackNodes();
            saveHistory();

            showToast("Audio adjustments reset.");
        }
    );

    $("compareBtn")?.addEventListener("click", () => {
        state.compareOriginal = !state.compareOriginal;

        if (state.compareOriginal) {
            Object.values(state.tracks).forEach((track) => {
                if (!track.nodes) return;

                const n = track.nodes;
                const now = state.audioContext?.currentTime || 0;

                n.bass.gain.setTargetAtTime(0, now, 0.015);
                n.mid.gain.setTargetAtTime(0, now, 0.015);
                n.treble.gain.setTargetAtTime(0, now, 0.015);

                n.reverbGain.gain.setTargetAtTime(0, now, 0.015);
                n.delayWet.gain.setTargetAtTime(0, now, 0.015);
                n.distortion.curve = null;
            });

            safeText($("compareBtn"), "Restore Effects");
            safeText($("compareStatus"), "Original sound");
        } else {
            updateAllTrackNodes();

            safeText($("compareBtn"), "Compare Original");
            safeText($("compareStatus"), "Effects enabled");
        }
    });

    /* --------------------------------------------------------
       MIXER CONTROLS
    -------------------------------------------------------- */

    const updateMixerLabels = () => {
        const master = $("mixerVolume");

        safeText(
            $("masterLevelText"),
            `${master ? master.value : 100}%`
        );

        safeText(
            $("monitoringValue"),
            `${$("monitoringControl")?.value || 0}%`
        );
    };

    $("mixerVolume")?.addEventListener("input", (event) => {
        const value = Number(event.target.value) / 100;

        if (state.masterGain && state.audioContext) {
            state.masterGain.gain.setTargetAtTime(
                state.masterMute ? 0 : value,
                state.audioContext.currentTime,
                0.015
            );
        }

        safeText(
            $("masterLevelText"),
            `${event.target.value}%`
        );
    });

    $("muteBtn")?.addEventListener("click", () => {
        state.masterMute = !state.masterMute;

        const button = $("muteBtn");
        button.setAttribute(
            "aria-pressed",
            String(state.masterMute)
        );

        safeText(
            button,
            state.masterMute ? "Unmute Master" : "Mute Master"
        );

        const masterVolume =
            Number($("mixerVolume")?.value || 100) / 100;

        if (state.masterGain && state.audioContext) {
            state.masterGain.gain.setTargetAtTime(
                state.masterMute ? 0 : masterVolume,
                state.audioContext.currentTime,
                0.015
            );
        }

        updateAllTrackNodes();
    });

    const bindTrackMixer = (
        volumeId,
        panId,
        type
    ) => {
        $(volumeId)?.addEventListener("input", (event) => {
            state.trackVolumes[type] = Number(event.target.value);

            updateTrackGain(state.tracks[type]);

            updateMixerLabels();
        });

        $(volumeId)?.addEventListener("change", saveHistory);

        $(panId)?.addEventListener("input", (event) => {
            state.trackPans[type] = Number(event.target.value);

            updateTrackGain(state.tracks[type]);
        });

        $(panId)?.addEventListener("change", saveHistory);
    };

    bindTrackMixer("mixerTrackVolume", "mixerPan", "music");
    bindTrackMixer("voiceVolume", "voicePan", "voice");
    bindTrackMixer(
        "instrumentMixerVolume",
        "instrumentMixerPan",
        "keyboard"
    );

    all("[data-track-action]").forEach((button) => {
        button.addEventListener("click", () => {
            const type = button.dataset.track;
            const action = button.dataset.trackAction;
            const track = state.tracks[type];

            if (!track) return;

            if (action === "mute") {
                track.muted = !track.muted;

                button.classList.toggle("active", track.muted);
                button.setAttribute(
                    "aria-pressed",
                    String(track.muted)
                );

                showToast(
                    `${track.name} ${track.muted ? "muted" : "unmuted"}.`
                );
            }

            if (action === "solo") {
                track.solo = !track.solo;

                button.classList.toggle("active", track.solo);
                button.setAttribute(
                    "aria-pressed",
                    String(track.solo)
                );

                showToast(
                    `${track.name} solo ${track.solo ? "enabled" : "disabled"}.`
                );
            }

            updateAllTrackNodes();
            saveHistory();
        });
    });

    /* --------------------------------------------------------
       NAVIGATION
    -------------------------------------------------------- */

    const openSection = (sectionId) => {
        const section = $(sectionId);

        if (!section) return;

        all(".workspace-section").forEach((item) => {
            item.classList.toggle(
                "active-section",
                item.id === sectionId
            );
        });

        all(".nav-item").forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.section === sectionId
            );
        });

        if (sectionId === "editorSection") {
            drawWaveform();
            updateTimeline();
        }

        if (sectionId === "keyboardSection") {
            buildKeyboard();
        }

        section.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    };

    all("[data-section]").forEach((button) => {
        button.addEventListener("click", () => {
            openSection(button.dataset.section);
        });
    });

    /* --------------------------------------------------------
       VOICE RECORDING
    -------------------------------------------------------- */

    const recording = state.recording;

    const updateRecordingTimer = () => {
        let elapsed = recording.elapsedBeforePause;

        if (
            recording.startedAt &&
            !recording.paused &&
            recording.mediaRecorder?.state === "recording"
        ) {
            elapsed += (Date.now() - recording.startedAt) / 1000;
        }

        safeText(
            $("recordingTimer"),
            formatLongTime(elapsed)
        );
    };

    const setRecordingButtons = (mode) => {
        setDisabled($("recordBtn"), mode === "recording" || mode === "paused");
        setDisabled($("pauseRecordBtn"), mode !== "recording");
        setDisabled($("resumeRecordBtn"), mode !== "paused");
        setDisabled($("stopRecordBtn"), mode !== "recording" && mode !== "paused");
    };

    const cleanupMicStream = () => {
        if (recording.stream) {
            recording.stream.getTracks().forEach((track) => {
                track.stop();
            });
        }

        recording.stream = null;

        if (recording.audioContextSource) {
            try {
                recording.audioContextSource.disconnect();
            } catch (_) {}
        }

        recording.audioContextSource = null;
    };

    const startMicVisualizer = async (stream) => {
        const context = await getAudioContext();

        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();

        analyser.fftSize = 1024;

        source.connect(analyser);

        recording.audioContextSource = source;
        recording.monitorAnalyser = analyser;

        const data = new Uint8Array(analyser.fftSize);
        const canvas = $("recordingWaveform");

        const draw = () => {
            if (!recording.monitorAnalyser) return;

            const ctx = canvas?.getContext("2d");

            if (ctx && canvas) {
                const width = canvas.clientWidth || 500;
                const height = canvas.clientHeight || 100;
                const ratio = window.devicePixelRatio || 1;

                if (
                    canvas.width !== Math.floor(width * ratio) ||
                    canvas.height !== Math.floor(height * ratio)
                ) {
                    canvas.width = Math.floor(width * ratio);
                    canvas.height = Math.floor(height * ratio);
                }

                ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
                ctx.clearRect(0, 0, width, height);

                analyser.getByteTimeDomainData(data);

                ctx.beginPath();
                ctx.strokeStyle = "#ff6d9d";
                ctx.lineWidth = 2;

                for (let i = 0; i < data.length; i++) {
                    const x = i / data.length * width;
                    const y = data[i] / 255 * height;

                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }

                ctx.stroke();
            }

            recording.visualizerFrame =
                requestAnimationFrame(draw);
        };

        draw();
    };

    const startVoiceRecording = async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error(
                    "Microphone recording is not supported here. Open the site using HTTPS in a modern browser."
                );
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            recording.stream = stream;
            recording.chunks = [];
            recording.blob = null;

            const mimeCandidates = [
                "audio/webm;codecs=opus",
                "audio/webm",
                "audio/ogg;codecs=opus",
                "audio/mp4"
            ];

            const mimeType = mimeCandidates.find((type) =>
                window.MediaRecorder &&
                MediaRecorder.isTypeSupported(type)
            );

            if (!window.MediaRecorder) {
                cleanupMicStream();

                throw new Error(
                    "MediaRecorder is not supported by this browser."
                );
            }

            recording.mediaRecorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            recording.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    recording.chunks.push(event.data);
                }
            };

            recording.mediaRecorder.onstop = () => {
                const actualType =
                    recording.mediaRecorder?.mimeType ||
                    "audio/webm";

                recording.blob = new Blob(recording.chunks, {
                    type: actualType
                });

                if (recording.url) {
                    URL.revokeObjectURL(recording.url);
                }

                recording.url = URL.createObjectURL(recording.blob);

                const preview = $("recordingPreview");

                if (preview) {
                    preview.src = recording.url;
                }

                safeText(
                    $("recordingResultStatus"),
                    `Recording ready · ${(recording.blob.size / 1024).toFixed(1)} KB`
                );

                setDisabled($("downloadRecordingBtn"), false);
                setDisabled($("useRecordingBtn"), false);
                setDisabled($("discardRecordingBtn"), false);

                cleanupMicStream();

                safeText($("recordingState"), "Recording Complete");
                safeText($("recordingOrb"), "✓");

                showToast("Voice recording completed.");
            };

            recording.elapsedBeforePause = 0;
            recording.startedAt = Date.now();
            recording.paused = false;

            recording.mediaRecorder.start(250);

            await startMicVisualizer(stream);

            safeText($("recordingState"), "Recording...");
            $("recordingOrb")?.classList.add("recording");

            setRecordingButtons("recording");

            clearInterval(recording.timer);

            recording.timer = setInterval(
                updateRecordingTimer,
                200
            );

            safeText(
                $("recordingResultStatus"),
                "Recording in progress..."
            );
        } catch (error) {
            console.error(error);
            cleanupMicStream();

            showToast(
                error.message || "Could not start voice recording.",
                5000
            );
        }
    };

    $("recordBtn")?.addEventListener(
        "click",
        startVoiceRecording
    );

    $("pauseRecordBtn")?.addEventListener("click", () => {
        if (
            recording.mediaRecorder?.state === "recording"
        ) {
            recording.elapsedBeforePause +=
                (Date.now() - recording.startedAt) / 1000;

            recording.mediaRecorder.pause();
            recording.paused = true;

            setRecordingButtons("paused");
            safeText($("recordingState"), "Recording Paused");
        }
    });

    $("resumeRecordBtn")?.addEventListener("click", () => {
        if (
            recording.mediaRecorder?.state === "paused"
        ) {
            recording.startedAt = Date.now();

            recording.mediaRecorder.resume();
            recording.paused = false;

            setRecordingButtons("recording");
            safeText($("recordingState"), "Recording...");
        }
    });

    $("stopRecordBtn")?.addEventListener("click", () => {
        if (
            recording.mediaRecorder &&
            recording.mediaRecorder.state !== "inactive"
        ) {
            clearInterval(recording.timer);

            recording.mediaRecorder.stop();

            setRecordingButtons("stopped");

            $("recordingOrb")?.classList.remove("recording");

            if (recording.visualizerFrame) {
                cancelAnimationFrame(
                    recording.visualizerFrame
                );
            }
        }
    });

    $("monitoringControl")?.addEventListener("input", async (event) => {
        const percent = Number(event.target.value);

        safeText($("monitoringValue"), `${percent}%`);

        if (!recording.stream) return;

        try {
            const context = await getAudioContext();

            if (!recording.monitorGain) {
                recording.monitorGain =
                    context.createGain();

                recording.monitorGain.connect(
                    context.destination
                );
            }

            recording.monitorGain.gain.setTargetAtTime(
                percent / 100,
                context.currentTime,
                0.02
            );

            if (!recording.monitorSource) {
                recording.monitorSource =
                    context.createMediaStreamSource(
                        recording.stream
                    );

                recording.monitorSource.connect(
                    recording.monitorGain
                );
            }
        } catch (error) {
            console.warn("Microphone monitoring error:", error);
        }
    });

    $("downloadRecordingBtn")?.addEventListener("click", () => {
        if (!recording.blob) return;

        const extension =
            recording.blob.type.includes("ogg")
                ? "ogg"
                : recording.blob.type.includes("mp4")
                    ? "m4a"
                    : "webm";

        downloadBlob(
            recording.blob,
            `naol-voice-recording.${extension}`
        );
    });

    const addBufferToTrack = async (buffer, type, name) => {
        const track = state.tracks[type];

        if (!track || !buffer) {
            showToast("There is no audio to add.");
            return;
        }

        stopPlayback();

        track.buffer = buffer;
        track.name = name;
        track.startOffset = 0;
        track.clipStart = 0;
        track.clipEnd = buffer.duration;
        track.nodes = null;

        state.selectedTrack = type;

        await createTrackNodes(track);

        updateAllTrackNodes();
        updateSelectedTrackInfo();
        drawWaveform();
        updateTimeline();
        renderTrackLibrary();
        updateExportSummary();
        saveHistory();

        showToast(`${name} added to the timeline.`);
    };

    const decodeBlobToBuffer = async (blob) => {
        const context = await getAudioContext();

        const data = await blob.arrayBuffer();

        return context.decodeAudioData(data.slice(0));
    };

    $("useRecordingBtn")?.addEventListener("click", async () => {
        if (!recording.blob) return;

        try {
            const buffer = await decodeBlobToBuffer(
                recording.blob
            );

            await addBufferToTrack(
                buffer,
                "voice",
                "Voice Recording"
            );

            openSection("editorSection");
        } catch (error) {
            console.error(error);

            showToast(
                "The recording is ready to download, but this browser could not decode it for the timeline."
            );
        }
    });

    $("discardRecordingBtn")?.addEventListener("click", () => {
        recording.blob = null;
        recording.chunks = [];

        if (recording.url) {
            URL.revokeObjectURL(recording.url);
            recording.url = null;
        }

        const preview = $("recordingPreview");

        if (preview) {
            preview.removeAttribute("src");
            preview.load();
        }

        setDisabled($("downloadRecordingBtn"), true);
        setDisabled($("useRecordingBtn"), true);
        setDisabled($("discardRecordingBtn"), true);

        safeText(
            $("recordingResultStatus"),
            "Recording discarded."
        );

        showToast("Recording discarded.");
    });

    /* --------------------------------------------------------
       PRESETS
    -------------------------------------------------------- */

    all("[data-preset]").forEach((button) => {
        button.addEventListener("click", () => {
            const presetName = button.dataset.preset;
            const preset = PRESETS[presetName];

            if (!preset) return;

            Object.assign(state.settings, preset);

            syncControlsFromState();
            updateAllTrackNodes();
            saveHistory();

            const message =
                `${presetName.charAt(0).toUpperCase() + presetName.slice(1)} preset applied.`;

            setStatus("presetStatus", message);
            showToast(message);
        });
    });

    /* --------------------------------------------------------
       VIRTUAL KEYBOARD
    -------------------------------------------------------- */

    const NOTE_NAMES = [
        "C", "C#", "D", "D#", "E", "F",
        "F#", "G", "G#", "A", "A#", "B"
    ];

    const midiToFrequency = (midi) =>
        440 * Math.pow(2, (midi - 69) / 12);

    const midiToName = (midi) => {
        const name = NOTE_NAMES[midi % 12];
        const octave = Math.floor(midi / 12) - 1;

        return `${name}${octave}`;
    };

    const getInstrument = () =>
        $("instrumentSelect")?.value || "piano";

    const playNote = async (midi, velocity = 0.8) => {
        const context = await getAudioContext();

        const voice = context.createGain();

        const frequency = midiToFrequency(midi);
        const volume =
            Number($("keyboardVolume")?.value || 70) / 100;

        const finalGain = clamp(
            volume * velocity,
            0,
            1
        );

        voice.gain.setValueAtTime(
            0.0001,
            context.currentTime
        );

        voice.gain.exponentialRampToValueAtTime(
            Math.max(0.001, finalGain),
            context.currentTime + 0.015
        );

        voice.connect(state.masterGain);

        const instrument = getInstrument();

        const oscillators = [];

        const makeOscillator = (
            type,
            freq,
            gainValue = 1
        ) => {
            const osc = context.createOscillator();
            const gain = context.createGain();

            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.value = gainValue;

            osc.connect(gain);
            gain.connect(voice);

            osc.start();

            oscillators.push({ osc, gain });

            return osc;
        };

        if (instrument === "bass") {
            makeOscillator("triangle", frequency, 1);
            makeOscillator("sine", frequency / 2, 0.3);
        } else if (instrument === "electric") {
            makeOscillator("sine", frequency, 0.8);
            makeOscillator("triangle", frequency * 2, 0.15);
        } else if (instrument === "synth") {
            makeOscillator("sawtooth", frequency, 0.35);
            makeOscillator("square", frequency * 1.005, 0.15);
        } else {
            makeOscillator("triangle", frequency, 0.8);
            makeOscillator("sine", frequency * 2, 0.12);
            makeOscillator("sine", frequency * 3, 0.04);
        }

        const recordEvent = {
            midi,
            velocity,
            time: state.keyboardRecording.active &&
                  !state.keyboardRecording.paused
                ? (
                    state.keyboardRecording.elapsedBeforePause +
                    (Date.now() -
                        state.keyboardRecording.startedAt) / 1000
                )
                : 0,
            type: "on"
        };

        if (
            state.keyboardRecording.active &&
            !state.keyboardRecording.paused
        ) {
            state.keyboardRecording.events.push(recordEvent);
        }

        state.activeNotes.set(midi, {
            voice,
            oscillators,
            startedAt: context.currentTime
        });

        const release = () => {
            const active = state.activeNotes.get(midi);

            if (!active) return;

            const now = context.currentTime;

            active.voice.gain.cancelScheduledValues(now);
            active.voice.gain.setTargetAtTime(
                0.0001,
                now,
                state.sustain ? 0.5 : 0.08
            );

            setTimeout(() => {
                active.oscillators.forEach(({ osc, gain }) => {
                    try {
                        osc.stop();
                        osc.disconnect();
                        gain.disconnect();
                    } catch (_) {}
                });

                try {
                    active.voice.disconnect();
                } catch (_) {}
            }, state.sustain ? 1800 : 500);

            state.activeNotes.delete(midi);

            if (
                state.keyboardRecording.active &&
                !state.keyboardRecording.paused
            ) {
                state.keyboardRecording.events.push({
                    midi,
                    time:
                        state.keyboardRecording.elapsedBeforePause +
                        (Date.now() -
                            state.keyboardRecording.startedAt) / 1000,
                    type: "off"
                });
            }
        };

        state.activeNotes.get(midi).release = release;

        const key = document.querySelector(
            `[data-midi="${midi}"]`
        );

        if (key) key.classList.add("pressed");

        return release;
    };

    const releaseNote = (midi) => {
        const note = state.activeNotes.get(midi);

        if (note && note.release) {
            note.release();
        }

        const key = document.querySelector(
            `[data-midi="${midi}"]`
        );

        if (key) key.classList.remove("pressed");
    };

    const buildKeyboard = () => {
        const container = $("pianoKeyboard");

        if (!container || container.dataset.built === "true") {
            return;
        }

        container.dataset.built = "true";
        container.innerHTML = "";

        const whiteNotes = [0, 2, 4, 5, 7, 9, 11];
        const blackNotes = [1, 3, 6, 8, 10];

        const octave = Number($("octaveSelect")?.value || 4);
        const startMidi = (octave + 1) * 12;

        const keys = [];

        for (let i = 0; i < 14; i++) {
            const noteIndex = i % 7;
            const octaveOffset = Math.floor(i / 7);

            const midi =
                startMidi +
                octaveOffset * 12 +
                whiteNotes[noteIndex];

            const key = document.createElement("button");

            key.type = "button";
            key.className = "piano-key white-key";
            key.dataset.midi = String(midi);
            key.setAttribute("aria-label", midiToName(midi));

            const label = document.createElement("span");
            label.textContent = midiToName(midi);

            key.appendChild(label);

            container.appendChild(key);
            keys.push({ midi, element: key, index: i });

            const begin = (event) => {
                event.preventDefault();

                if (key.dataset.active === "true") return;

                key.dataset.active = "true";

                playNote(midi).catch((error) => {
                    console.error(error);
                    showToast("Could not play this note.");
                });
            };

            const end = (event) => {
                if (event) event.preventDefault();

                key.dataset.active = "false";
                releaseNote(midi);
            };

            key.addEventListener("pointerdown", begin);
            key.addEventListener("pointerup", end);
            key.addEventListener("pointerleave", (event) => {
                if (key.dataset.active === "true") end(event);
            });
            key.addEventListener("pointercancel", end);
        }

        keys.forEach(({ midi, element, index }) => {
            const note = NOTE_NAMES[midi % 12];

            if (!blackNotes.includes(NOTE_NAMES.indexOf(note))) {
                return;
            }

            const black = document.createElement("button");

            black.type = "button";
            black.className = "piano-key black-key";
            black.dataset.midi = String(midi);
            black.setAttribute("aria-label", midiToName(midi));

            black.style.position = "absolute";
            black.style.left =
                `calc(${(index + 1) / 14 * 100}% - 12px)`;

            container.appendChild(black);

            const begin = (event) => {
                event.preventDefault();

                if (black.dataset.active === "true") return;

                black.dataset.active = "true";

                playNote(midi).catch(console.error);
                black.classList.add("pressed");
            };

            const end = (event) => {
                if (event) event.preventDefault();

                black.dataset.active = "false";
                releaseNote(midi);
                black.classList.remove("pressed");
            };

            black.addEventListener("pointerdown", begin);
            black.addEventListener("pointerup", end);
            black.addEventListener("pointerleave", (event) => {
                if (black.dataset.active === "true") end(event);
            });
            black.addEventListener("pointercancel", end);
        });

        container.style.position = "relative";
        container.style.display = "flex";
        container.style.minHeight = "160px";
    };

    $("octaveSelect")?.addEventListener("change", () => {
        allNotesOff();

        const container = $("pianoKeyboard");

        if (container) {
            container.dataset.built = "false";
        }

        buildKeyboard();

        setStatus(
            "keyboardStatus",
            `Octave ${$("octaveSelect").value} selected.`
        );
    });

    $("instrumentSelect")?.addEventListener("change", () => {
        setStatus(
            "keyboardStatus",
            `${getInstrument()} selected.`
        );
    });

    const allNotesOff = () => {
        Array.from(state.activeNotes.keys()).forEach(
            (midi) => releaseNote(midi)
        );
    };

    $("sustainBtn")?.addEventListener("click", () => {
        state.sustain = !state.sustain;

        const button = $("sustainBtn");

        button.setAttribute(
            "aria-pressed",
            String(state.sustain)
        );

        safeText(
            button,
            state.sustain ? "Sustain ON" : "Sustain OFF"
        );
    });

    /* --------------------------------------------------------
       KEYBOARD PERFORMANCE RECORDING
    -------------------------------------------------------- */

    const kr = state.keyboardRecording;

    const updateKeyboardRecordButtons = (mode) => {
        setDisabled(
            $("recordKeyboardBtn"),
            mode === "recording" || mode === "paused"
        );

        setDisabled(
            $("pauseKeyboardBtn"),
            mode !== "recording"
        );

        setDisabled(
            $("resumeKeyboardBtn"),
            mode !== "paused"
        );

        setDisabled(
            $("stopKeyboardBtn"),
            mode !== "recording" && mode !== "paused"
        );
    };

    $("recordKeyboardBtn")?.addEventListener("click", () => {
        kr.active = true;
        kr.paused = false;
        kr.startedAt = Date.now();
        kr.elapsedBeforePause = 0;
        kr.events = [];

        updateKeyboardRecordButtons("recording");

        setStatus(
            "keyboardStatus",
            "Recording performance. Play some notes."
        );

        showToast("Keyboard recording started.");
    });

    $("pauseKeyboardBtn")?.addEventListener("click", () => {
        if (!kr.active || kr.paused) return;

        kr.elapsedBeforePause +=
            (Date.now() - kr.startedAt) / 1000;

        kr.paused = true;

        updateKeyboardRecordButtons("paused");

        setStatus("keyboardStatus", "Keyboard recording paused.");
    });

    $("resumeKeyboardBtn")?.addEventListener("click", () => {
        if (!kr.active || !kr.paused) return;

        kr.startedAt = Date.now();
        kr.paused = false;

        updateKeyboardRecordButtons("recording");

        setStatus("keyboardStatus", "Keyboard recording resumed.");
    });

    const buildKeyboardBuffer = async () => {
        const context = await getAudioContext();

        const events = kr.events.slice();

        if (!events.length) {
            return null;
        }

        const maxTime = Math.max(
            0.2,
            ...events.map((event) => event.time)
        ) + 0.5;

        const sampleRate = context.sampleRate;

        const offline = new OfflineAudioContext(
            2,
            Math.ceil(maxTime * sampleRate),
            sampleRate
        );

        const voices = new Map();

        events.forEach((event) => {
            const time = clamp(event.time, 0, maxTime);

            if (event.type === "on") {
                const osc = offline.createOscillator();
                const gain = offline.createGain();

                osc.type = getInstrument() === "bass"
                    ? "triangle"
                    : getInstrument() === "synth"
                        ? "sawtooth"
                        : "sine";

                osc.frequency.value =
                    midiToFrequency(event.midi);

                gain.gain.setValueAtTime(0.0001, time);

                gain.gain.linearRampToValueAtTime(
                    Number($("keyboardVolume")?.value || 70) / 100 *
                    Number(event.velocity || 0.8),
                    time + 0.015
                );

                osc.connect(gain);
                gain.connect(offline.destination);

                osc.start(time);

                voices.set(event.midi, { osc, gain, start: time });
            } else {
                const voice = voices.get(event.midi);

                if (!voice) return;

                const releaseTime = Math.min(
                    maxTime,
                    Math.max(time, voice.start + 0.02)
                );

                voice.gain.gain.setTargetAtTime(
                    0.0001,
                    releaseTime,
                    0.04
                );

                try {
                    voice.osc.stop(
                        Math.min(maxTime, releaseTime + 0.3)
                    );
                } catch (_) {}
            }
        });

        voices.forEach((voice) => {
            try {
                voice.osc.stop(maxTime);
            } catch (_) {}
        });

        return offline.startRendering();
    };

    $("stopKeyboardBtn")?.addEventListener("click", async () => {
        if (!kr.active) return;

        kr.active = false;
        kr.paused = false;

        updateKeyboardRecordButtons("stopped");

        setStatus(
            "keyboardStatus",
            "Rendering keyboard performance..."
        );

        try {
            kr.buffer = await buildKeyboardBuffer();

            if (!kr.buffer) {
                setStatus(
                    "keyboardStatus",
                    "No notes were recorded. Play the keyboard and try again."
                );

                return;
            }

            setDisabled($("playKeyboardRecordingBtn"), false);
            setDisabled($("useKeyboardRecordingBtn"), false);
            setDisabled($("downloadKeyboardRecordingBtn"), false);

            setStatus(
                "keyboardStatus",
                `Performance ready · ${formatTime(kr.buffer.duration)}`
            );

            showToast("Keyboard performance ready.");
        } catch (error) {
            console.error(error);

            setStatus(
                "keyboardStatus",
                "Could not render the keyboard performance."
            );
        }
    });

    const playBufferPreview = async (buffer) => {
        if (!buffer) {
            showToast("No recording is available.");
            return;
        }

        const context = await getAudioContext();
        const source = context.createBufferSource();

        source.buffer = buffer;
        source.connect(state.masterGain);
        source.start();

        source.onended = () => {
            try {
                source.disconnect();
            } catch (_) {}
        };
    };

    $("playKeyboardRecordingBtn")?.addEventListener(
        "click",
        async () => {
            await playBufferPreview(kr.buffer);
        }
    );

    $("useKeyboardRecordingBtn")?.addEventListener(
        "click",
        async () => {
            if (!kr.buffer) return;

            await addBufferToTrack(
                kr.buffer,
                "keyboard",
                "Keyboard Performance"
            );

            openSection("editorSection");
        }
    );

    /* --------------------------------------------------------
       WAV ENCODING
    -------------------------------------------------------- */

    const audioBufferToWav = (
        audioBuffer,
        channels = "stereo",
        normalize = false
    ) => {
        const outputChannels =
            channels === "mono" ? 1 : 2;

        const sampleRate = audioBuffer.sampleRate;

        const frameCount = audioBuffer.length;

        const channelData = [];

        for (let channel = 0; channel < outputChannels; channel++) {
            if (outputChannels === 1) {
                const mono = new Float32Array(frameCount);

                for (
                    let inputChannel = 0;
                    inputChannel < audioBuffer.numberOfChannels;
                    inputChannel++
                ) {
                    const input =
                        audioBuffer.getChannelData(inputChannel);

                    for (let i = 0; i < frameCount; i++) {
                        mono[i] +=
                            input[i] /
                            audioBuffer.numberOfChannels;
                    }
                }

                channelData.push(mono);
            } else if (
                channel < audioBuffer.numberOfChannels
            ) {
                channelData.push(
                    audioBuffer.getChannelData(channel)
                );
            } else {
                channelData.push(
                    audioBuffer.getChannelData(0)
                );
            }
        }

        let peak = 0;

        for (const data of channelData) {
            for (let i = 0; i < data.length; i++) {
                peak = Math.max(peak, Math.abs(data[i]));
            }
        }

        const normalizationGain =
            normalize && peak > 0
                ? Math.min(1 / peak, 4)
                : 1;

        const bytesPerSample = 2;
        const blockAlign =
            outputChannels * bytesPerSample;

        const dataSize =
            frameCount * blockAlign;

        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, "WAVE");

        writeString(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, outputChannels, true);
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

        for (let frame = 0; frame < frameCount; frame++) {
            for (
                let channel = 0;
                channel < outputChannels;
                channel++
            ) {
                let sample =
                    channelData[channel][frame] *
                    normalizationGain;

                sample = clamp(sample, -1, 1);

                const intSample =
                    sample < 0
                        ? sample * 32768
                        : sample * 32767;

                view.setInt16(
                    offset,
                    intSample,
                    true
                );

                offset += 2;
            }
        }

        return new Blob([buffer], {
            type: "audio/wav"
        });
    };

    const renderExportBuffer = async () => {
        const sampleRate =
            Number($("exportSampleRate")?.value || 44100);

        const sourceMode =
            $("exportSource")?.value || "mix";

        const selectedTracks =
            sourceMode === "music"
                ? [state.tracks.music]
                : Object.values(state.tracks);

        const usableTracks = selectedTracks.filter(
            (track) => track.buffer
        );

        if (!usableTracks.length) {
            throw new Error(
                "There is no audio to export. Import or record audio first."
            );
        }

        const duration = Math.max(
            0.1,
            ...usableTracks.map(
                (track) =>
                    track.startOffset + getTrackDuration(track)
            )
        );

        const offline = new OfflineAudioContext(
            2,
            Math.ceil(duration * sampleRate),
            sampleRate
        );

        const master = offline.createGain();

        master.gain.value = state.masterMute
            ? 0
            : Number($("mixerVolume")?.value || 100) / 100;

        master.connect(offline.destination);

        const s = state.settings;

        for (const track of usableTracks) {
            if (!track.buffer || !isTrackAudible(track)) continue;

            const source = offline.createBufferSource();
            source.buffer = track.buffer;

            const gain = offline.createGain();

            const bass = offline.createBiquadFilter();
            bass.type = "lowshelf";
            bass.frequency.value = 180;
            bass.gain.value = Number(s.bass);

            const mid = offline.createBiquadFilter();
            mid.type = "peaking";
            mid.frequency.value = 1000;
            mid.Q.value = 0.8;
            mid.gain.value = Number(s.mid);

            const treble = offline.createBiquadFilter();
            treble.type = "highshelf";
            treble.frequency.value = 5000;
            treble.gain.value = Number(s.treble);

            const distortion = offline.createWaveShaper();
            distortion.oversample = "2x";

            const amount =
                clamp(Number(s.distortion) / 100, 0, 1);

            distortion.curve =
                amount > 0
                    ? makeDistortionCurve(amount)
                    : null;

            const pan = offline.createStereoPanner();

            pan.pan.value = clamp(
                (
                    Number(state.trackPans[track.type] || 0) +
                    (track.type === "music"
                        ? Number(s.pan)
                        : 0)
                ) / 100,
                -1,
                1
            );

            const trackVolume =
                Number(state.trackVolumes[track.type] ?? 100) /
                100;

            const settingsVolume =
                track.type === "music"
                    ? Number(s.volume) / 100
                    : 1;

            const overallGain =
                trackVolume *
                settingsVolume *
                Number(track.volume ?? 1);

            const start =
                Math.max(0, Number(track.startOffset || 0));

            const clipStart =
                Number(track.clipStart || 0);

            const clipEnd =
                track.clipEnd == null
                    ? track.buffer.duration
                    : Math.min(
                        track.clipEnd,
                        track.buffer.duration
                    );

            const clipDuration = clipEnd - clipStart;

            if (clipDuration <= 0) continue;

            gain.gain.setValueAtTime(
                overallGain,
                start
            );

            if (s.fadeIn > 0) {
                gain.gain.setValueAtTime(
                    0,
                    start
                );

                gain.gain.linearRampToValueAtTime(
                    overallGain,
                    start + Math.min(
                        Number(s.fadeIn),
                        clipDuration
                    )
                );
            }

            if (s.fadeOut > 0) {
                const fadeStart = Math.max(
                    start,
                    start + clipDuration - Number(s.fadeOut)
                );

                gain.gain.setValueAtTime(
                    overallGain,
                    fadeStart
                );

                gain.gain.linearRampToValueAtTime(
                    0,
                    start + clipDuration
                );
            }

            source.connect(bass);
            bass.connect(mid);
            mid.connect(treble);
            treble.connect(distortion);
            distortion.connect(gain);
            gain.connect(pan);
            pan.connect(master);

            source.playbackRate.value = 1;

            source.start(
                start,
                clipStart,
                clipDuration
            );
        }

        setExportProgress(35, "Rendering audio...");

        return offline.startRendering();
    };

    const setExportProgress = (percent, message) => {
        const value = clamp(percent, 0, 100);

        safeText($("exportProgressText"), message);
        safeText($("exportProgressPercent"), `${Math.round(value)}%`);

        const bar = $("exportProgress");

        if (bar) {
            bar.style.width = `${value}%`;
        }
    };

    const updateExportSummary = () => {
        safeText(
            $("exportDuration"),
            getProjectDuration()
                ? formatTime(getProjectDuration())
                : "--"
        );

        safeText(
            $("exportFormatSummary"),
            ($("exportFormat")?.value || "wav").toUpperCase()
        );

        safeText(
            $("exportSampleRateSummary"),
            `${Number($("exportSampleRate")?.value || 44100) / 1000} kHz`
        );

        safeText(
            $("exportQualitySummary"),
            $("exportQuality")?.value === "standard"
                ? "Standard Quality"
                : "High Quality"
        );
    };

    [
        "exportFormat",
        "exportSampleRate",
        "exportQuality",
        "exportChannels",
        "exportSource",
        "normalizeExport"
    ].forEach((id) => {
        $(id)?.addEventListener("change", () => {
            updateExportSummary();

            if ($("exportFormat")?.value === "mp3") {
                setStatus(
                    "exportStatus",
                    "MP3 export is unavailable without an MP3 encoder. Choose WAV."
                );
            } else {
                setStatus(
                    "exportStatus",
                    "WAV export is ready."
                );
            }
        });
    });

    $("exportBtn")?.addEventListener("click", async () => {
        try {
            if ($("exportFormat")?.value === "mp3") {
                setStatus(
                    "exportStatus",
                    "MP3 export is unavailable because this project does not include an MP3 encoder. Select WAV instead."
                );

                showToast("Select WAV to export audio.");
                return;
            }

            if (!getProjectDuration()) {
                showToast("Import or record audio before exporting.");
                return;
            }

            setDisabled($("exportBtn"), true);
            setDisabled($("downloadExportBtn"), true);

            setExportProgress(5, "Preparing export...");
            setStatus("exportStatus", "Rendering audio...");

            const buffer = await renderExportBuffer();

            setExportProgress(75, "Encoding WAV...");

            state.exportBlob = audioBufferToWav(
                buffer,
                $("exportChannels")?.value || "stereo",
                Boolean($("normalizeExport")?.checked)
            );

            const filename = cleanFilename(
                $("exportFileName")?.value ||
                "naol-music-studio"
            );

            state.exportFilename = `${filename}.wav`;

            setExportProgress(100, "Export complete.");

            setStatus(
                "exportStatus",
                `Ready: ${state.exportFilename} · ${(state.exportBlob.size / 1024 / 1024).toFixed(2)} MB`
            );

            setDisabled($("downloadExportBtn"), false);

            showToast("WAV export rendered successfully.");
        } catch (error) {
            console.error(error);

            setStatus(
                "exportStatus",
                error.message || "Export failed."
            );

            setExportProgress(0, "Export failed.");

            showToast(
                error.message || "Could not export audio.",
                5000
            );
        } finally {
            setDisabled($("exportBtn"), false);
        }
    });

    $("downloadExportBtn")?.addEventListener("click", () => {
        if (!state.exportBlob) {
            showToast("Render the export before downloading.");
            return;
        }

        downloadBlob(
            state.exportBlob,
            state.exportFilename || "naol-music-studio.wav"
        );
    });

    /* --------------------------------------------------------
       AUDIO ANALYSIS
    -------------------------------------------------------- */

    $("analyzeAudioBtn")?.addEventListener("click", () => {
        const track = getSelectedTrack();

        if (!track || !track.buffer) {
            setStatus(
                "analysisStatus",
                "Select a track containing audio before analysis."
            );

            showToast("No audio to analyze.");
            return;
        }

        const buffer = track.buffer;

        let peak = 0;
        let sumSquares = 0;
        let samples = 0;

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
                samples++;
            }
        }

        const rms = samples
            ? Math.sqrt(sumSquares / samples)
            : 0;

        safeText(
            $("analysisDuration"),
            formatTime(buffer.duration)
        );

        safeText(
            $("analysisPeak"),
            `${(20 * Math.log10(Math.max(peak, 0.000001))).toFixed(1)} dBFS`
        );

        safeText(
            $("analysisRms"),
            `${(20 * Math.log10(Math.max(rms, 0.000001))).toFixed(1)} dBFS`
        );

        safeText(
            $("analysisSampleRate"),
            `${buffer.sampleRate} Hz`
        );

        setStatus(
            "analysisStatus",
            `Analysis complete for ${track.name}.`
        );

        showToast("Audio analysis complete.");
    });

    /* --------------------------------------------------------
       VISUALIZERS AND METERS
    -------------------------------------------------------- */

    const drawSpectrum = (
        canvas,
        analyser,
        color = "#64e8ff"
    ) => {
        if (!canvas || !analyser) return;

        const context = canvas.getContext("2d");

        if (!context) return;

        const width = canvas.clientWidth || 500;
        const height = canvas.clientHeight || 100;
        const ratio = window.devicePixelRatio || 1;

        if (
            canvas.width !== Math.floor(width * ratio) ||
            canvas.height !== Math.floor(height * ratio)
        ) {
            canvas.width = Math.floor(width * ratio);
            canvas.height = Math.floor(height * ratio);
        }

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);

        const data = new Uint8Array(analyser.frequencyBinCount);

        analyser.getByteFrequencyData(data);

        const barWidth = Math.max(
            2,
            width / data.length * 2
        );

        let x = 0;

        for (let i = 0; i < data.length; i += 2) {
            const value = data[i] / 255;
            const barHeight = value * height;

            context.fillStyle = color;

            context.fillRect(
                x,
                height - barHeight,
                Math.max(1, barWidth - 1),
                barHeight
            );

            x += barWidth;
        }
    };

    const drawMasterMeter = () => {
        if (!state.masterMeterAnalyser) return;

        const analyser = state.masterMeterAnalyser;

        const data = new Uint8Array(
            analyser.frequencyBinCount
        );

        analyser.getByteFrequencyData(data);

        let sum = 0;

        for (let i = 0; i < data.length; i++) {
            sum += data[i];
        }

        const level = data.length
            ? sum / data.length / 255
            : 0;

        const percent = clamp(level * 180, 0, 100);

        const masterMeter = $("masterMeter");

        if (masterMeter) {
            masterMeter.style.width = `${percent}%`;
        }

        const audioMeter = $("audioMeter");

        drawSpectrum(
            audioMeter,
            analyser,
            "#79f7d4"
        );

        const voice = state.tracks.voice;
        const keyboard = state.tracks.keyboard;

        if (voice.nodes) {
            drawMiniMeter(
                $("voiceMeter"),
                voice.nodes.outputAnalyser
            );
        }

        if (keyboard.nodes) {
            drawMiniMeter(
                $("keyboardMeter"),
                keyboard.nodes.outputAnalyser
            );
        }

        if (percent > 90) {
            safeText(
                $("clippingStatus"),
                "High output level"
            );
        } else {
            safeText(
                $("clippingStatus"),
                "Output ready"
            );
        }
    };

    const drawMiniMeter = (element, analyser) => {
        if (!element || !analyser) return;

        const data = new Uint8Array(
            analyser.frequencyBinCount
        );

        analyser.getByteFrequencyData(data);

        let total = 0;

        for (let i = 0; i < data.length; i++) {
            total += data[i];
        }

        const level = data.length
            ? total / data.length / 255
            : 0;

        element.style.width =
            `${clamp(level * 200, 0, 100)}%`;
    };

    const startVisualizers = () => {
        if (state.animationFrame) return;

        const draw = () => {
            if (state.masterAnalyser) {
                drawSpectrum(
                    $("visualizer"),
                    state.masterAnalyser
                );
            }

            drawMasterMeter();

            state.animationFrame =
                requestAnimationFrame(draw);
        };

        draw();
    };

    /* --------------------------------------------------------
       PROJECT SAVE / RESTORE
    -------------------------------------------------------- */

    const serializeProject = () => {
        const project = captureProjectState();

        project.version = 1;
        project.createdAt = new Date().toISOString();

        return project;
    };

    const saveProject = () => {
        try {
            const project = serializeProject();

            localStorage.setItem(
                "naolMusicStudioProject",
                JSON.stringify(project)
            );

            safeText($("projectState"), "Saved");
            safeText($("saveStatus"), "Saved");

            showToast(
                "Project settings saved in this browser. Audio files are not embedded."
            );
        } catch (error) {
            console.error(error);

            showToast(
                "Project could not be saved. Browser storage may be full."
            );
        }
    };

    $("saveProjectBtn")?.addEventListener(
        "click",
        saveProject
    );

    $("backupProjectBtn")?.addEventListener("click", () => {
        const data = JSON.stringify(
            serializeProject(),
            null,
            2
        );

        const blob = new Blob(
            [data],
            { type: "application/json" }
        );

        downloadBlob(
            blob,
            `${cleanFilename($("projectName")?.value)}-backup.json`
        );

        showToast("Project settings backup downloaded.");
    });

    $("restoreProjectInput")?.addEventListener(
        "change",
        async (event) => {
            const file = event.target.files?.[0];

            if (!file) return;

            try {
                const project = JSON.parse(
                    await file.text()
                );

                if (
                    !project ||
                    typeof project !== "object" ||
                    !project.tracks
                ) {
                    throw new Error("Invalid project backup file.");
                }

                applyHistorySnapshot(project);

                saveHistory();

                safeText($("projectState"), "Restored");

                showToast(
                    "Project settings restored. Re-import audio files because backups do not contain audio data."
                );
            } catch (error) {
                console.error(error);

                showToast(
                    error.message || "Could not restore this project."
                );
            } finally {
                event.target.value = "";
            }
        }
    );

    $("undoBtn")?.addEventListener("click", () => {
        moveHistory(-1);
    });

    $("redoBtn")?.addEventListener("click", () => {
        moveHistory(1);
    });

    $("projectName")?.addEventListener("input", () => {
        safeText($("projectState"), "Modified");
    });

    /* --------------------------------------------------------
       KEYBOARD SHORTCUTS
    -------------------------------------------------------- */

    document.addEventListener("keydown", async (event) => {
        const target = event.target;

        if (
            target &&
            (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" ||
                target.isContentEditable
            )
        ) {
            return;
        }

        if (event.code === "Space") {
            event.preventDefault();

            if (state.playing) {
                const position = getCurrentPosition();

                stopPlayback(false);
                state.playbackPosition = position;
            } else {
                await startPlayback(state.playbackPosition);
            }
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
        ) {
            event.preventDefault();
            saveProject();
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "z"
        ) {
            event.preventDefault();
            moveHistory(-1);
        }

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "y"
        ) {
            event.preventDefault();
            moveHistory(1);
        }
    });

    /* --------------------------------------------------------
       RESIZE HANDLING
    -------------------------------------------------------- */

    window.addEventListener("resize", () => {
        drawWaveform();
        updateTimeline();
    });

    /* --------------------------------------------------------
       INITIALIZATION
    -------------------------------------------------------- */

    const initialize = () => {
        syncControlsFromState();

        renderTrackLibrary();

        updateSelectedTrackInfo();

        updateTimeline();

        updateExportSummary();

        buildKeyboard();

        setDisabled($("undoBtn"), true);
        setDisabled($("redoBtn"), true);

        setDisabled($("pauseRecordBtn"), true);
        setDisabled($("resumeRecordBtn"), true);
        setDisabled($("stopRecordBtn"), true);

        setDisabled($("pauseKeyboardBtn"), true);
        setDisabled($("resumeKeyboardBtn"), true);
        setDisabled($("stopKeyboardBtn"), true);

        setDisabled($("downloadRecordingBtn"), true);
        setDisabled($("useRecordingBtn"), true);
        setDisabled($("discardRecordingBtn"), true);

        setDisabled($("playKeyboardRecordingBtn"), true);
        setDisabled($("useKeyboardRecordingBtn"), true);
        setDisabled($("downloadKeyboardRecordingBtn"), true);

        setDisabled($("downloadExportBtn"), true);

        safeText($("engineStatus"), "Standby");
        safeText(
            $("engineFooterStatus"),
            "Audio engine ready when needed"
        );

        state.history.push(captureProjectState());
        state.historyIndex = 0;

        safeText(
            $("timelineHelp"),
            "Import audio, record your voice or play the virtual keyboard to build your project."
        );

        console.log(
            "Naol Music Studio 3D initialized successfully."
        );
    };

    initialize();
});
