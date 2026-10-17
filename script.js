"use strict";

/* =========================================================
   NAOL MUSIC STUDIO 3D
   Complete browser-based audio editor
   ========================================================= */

(() => {
  /* -------------------------------------------------------
     HELPERS
     ------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);

  const $$ = (selector, parent = document) =>
    Array.from(parent.querySelectorAll(selector));

  const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
      seconds = 0;
    }

    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);

    return (
      String(minutes).padStart(2, "0") +
      ":" +
      String(remaining).padStart(2, "0")
    );
  };

  const safeText = (value) =>
    String(value ?? "").replace(/[<>]/g, "");

  const hasAudio = (track) =>
    Boolean(track && track.audio && track.audio.buffer);

  const isMobile = () =>
    window.matchMedia("(max-width: 760px)").matches;

  /* -------------------------------------------------------
     DOM STATE
     ------------------------------------------------------- */

  const state = {
    initialized: false,

    audioContext: null,
    masterGain: null,
    masterAnalyser: null,
    masterCompressor: null,

    tracks: {
      music: createTrack("music"),
      voice: createTrack("voice"),
      keyboard: createTrack("keyboard")
    },

    selectedTrack: "music",

    isPlaying: false,
    playStartedAt: 0,
    playStartOffset: 0,
    playbackTimer: null,
    animationFrame: null,

    playbackSpeed: 1,
    masterVolume: 0.8,

    currentAudioUrl: null,
    currentRecordingUrl: null,
    currentKeyboardUrl: null,
    currentExportUrl: null,

    mediaRecorder: null,
    mediaStream: null,
    recordingChunks: [],
    recordingStartedAt: 0,
    recordingElapsedBeforePause: 0,
    recordingTimer: null,
    recordingPaused: false,

    keyboardNotes: new Map(),
    keyboardRecording: [],
    keyboardRecordingStartedAt: 0,
    keyboardRecordingPausedAt: 0,
    keyboardRecordingPauseTotal: 0,
    keyboardIsRecording: false,
    keyboardIsPaused: false,

    heldKeyboardNotes: new Map(),

    activePreset: "clean",
    comparingOriginal: false,

    undoStack: [],
    redoStack: [],

    toastTimer: null,

    zoom: 1,

    exportBlob: null,

    originalSettings: null,

    projectName: "Naol Music Studio Project"
  };

  function createTrack(type) {
    return {
      type,
      audio: null,
      source: null,

      gain: null,
      pan: null,

      bass: null,
      mid: null,
      treble: null,

      distortion: null,
      distortionWet: null,

      delay: null,
      delayFeedback: null,
      delayWet: null,

      reverb: null,
      reverbWet: null,

      output: null,

      volume: type === "music" ? 0.8 : 0.8,
      panValue: 0,

      muted: false,
      solo: false,

      startOffset: 0,
      trimStart: 0,
      trimEnd: null,

      startedAt: 0,
      sourceStartOffset: 0,

      audioElement: null,
      audioElementSource: null,

      waveform: null,
      duration: 0,

      name:
        type === "music"
          ? "Music Track"
          : type === "voice"
            ? "Voice Track"
            : "Keyboard Track"
    };
  }

  /* -------------------------------------------------------
     TOAST / STATUS
     ------------------------------------------------------- */

  function toast(message, duration = 2800) {
    const element = $("toast");

    if (!element) {
      console.log("[Naol Music Studio]", message);
      return;
    }

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      element.classList.remove("show");
    }, duration);
  }

  function setStatus(id, message) {
    const element = $(id);

    if (element) {
      element.textContent = message;
    }
  }

  function setSaveStatus(message) {
    setStatus("saveStatus", message);
  }

  function setEngineStatus(message) {
    setStatus("engineStatus", message);
    setStatus("engineFooterStatus", message);
  }

  /* -------------------------------------------------------
     AUDIO CONTEXT
     ------------------------------------------------------- */

  async function ensureAudioContext() {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error(
        "Browseriin kee Web Audio API hin deeggaru."
      );
    }

    if (!state.audioContext) {
      state.audioContext = new AudioContextClass();

      state.masterGain =
        state.audioContext.createGain();

      state.masterAnalyser =
        state.audioContext.createAnalyser();

      state.masterAnalyser.fftSize = 2048;

      state.masterCompressor =
        state.audioContext.createDynamicsCompressor();

      state.masterCompressor.threshold.value = -4;
      state.masterCompressor.knee.value = 8;
      state.masterCompressor.ratio.value = 4;
      state.masterCompressor.attack.value = 0.003;
      state.masterCompressor.release.value = 0.2;

      state.masterGain.gain.value = state.masterVolume;

      state.masterGain.connect(state.masterCompressor);

      state.masterCompressor.connect(
        state.masterAnalyser
      );

      state.masterAnalyser.connect(
        state.audioContext.destination
      );

      setEngineStatus("Audio Engine Ready");
    }

    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
    }

    return state.audioContext;
  }

  function createDistortionCurve(amount = 0) {
    const samples = 44100;
    const curve = new Float32Array(samples + 1);

    const drive = clamp(amount, 0, 100) / 100;

    for (let i = 0; i <= samples; i++) {
      const x = (i * 2) / samples - 1;

      curve[i] =
        drive === 0
          ? x
          : Math.tanh(x * (1 + drive * 35)) /
            Math.tanh(1 + drive * 35);
    }

    return curve;
  }

  function createImpulseResponse(
    context,
    seconds = 1.3,
    decay = 2.5
  ) {
    const length = Math.max(
      1,
      Math.floor(context.sampleRate * seconds)
    );

    const impulse = context.createBuffer(
      2,
      length,
      context.sampleRate
    );

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        const fade = Math.pow(
          1 - i / length,
          decay
        );

        data[i] =
          (Math.random() * 2 - 1) * fade;
      }
    }

    return impulse;
  }

  /* -------------------------------------------------------
     TRACK AUDIO GRAPH
     ------------------------------------------------------- */

  async function ensureTrackGraph(track) {
    const context = await ensureAudioContext();

    if (track.source && track.output) {
      return track;
    }

    track.gain = context.createGain();

    track.pan = context.createStereoPanner
      ? context.createStereoPanner()
      : null;

    track.bass = context.createBiquadFilter();
    track.bass.type = "lowshelf";
    track.bass.frequency.value = 200;

    track.mid = context.createBiquadFilter();
    track.mid.type = "peaking";
    track.mid.frequency.value = 1000;
    track.mid.Q.value = 0.8;

    track.treble = context.createBiquadFilter();
    track.treble.type = "highshelf";
    track.treble.frequency.value = 4500;

    track.distortion = context.createWaveShaper();
    track.distortion.curve = createDistortionCurve(0);
    track.distortion.oversample = "2x";

    track.distortionWet = context.createGain();
    track.distortionWet.gain.value = 0;

    track.delay = context.createDelay(2);
    track.delay.delayTime.value = 0.25;

    track.delayFeedback = context.createGain();
    track.delayFeedback.gain.value = 0.2;

    track.delayWet = context.createGain();
    track.delayWet.gain.value = 0;

    track.reverb = context.createConvolver();
    track.reverb.buffer = createImpulseResponse(context);

    track.reverbWet = context.createGain();
    track.reverbWet.gain.value = 0;

    track.output = context.createGain();

    /*
      Main path:
      source -> EQ -> distortion -> pan -> gain -> output

      Effect sends:
      EQ -> delay -> feedback
      EQ -> reverb
    */

    track.source = context.createGain();

    track.source.connect(track.bass);

    track.bass.connect(track.mid);
    track.mid.connect(track.treble);

    track.treble.connect(track.distortion);

    track.distortion.connect(track.distortionWet);

    track.distortionWet.connect(track.pan || track.gain);

    if (track.pan) {
      track.pan.connect(track.gain);
    }

    track.gain.connect(track.output);
    track.output.connect(state.masterGain);

    track.treble.connect(track.delay);
    track.delay.connect(track.delayWet);
    track.delayWet.connect(track.output);

    track.delay.connect(track.delayFeedback);
    track.delayFeedback.connect(track.delay);

    track.treble.connect(track.reverb);
    track.reverb.connect(track.reverbWet);
    track.reverbWet.connect(track.output);

    applyTrackSettings(track);

    return track;
  }

  function applyTrackSettings(track) {
    if (!state.audioContext || !track.gain) {
      return;
    }

    const now = state.audioContext.currentTime;

    const volume = clamp(
      Number(track.volume),
      0,
      1.5
    );

    track.gain.gain.setTargetAtTime(
      volume,
      now,
      0.025
    );

    if (track.pan) {
      track.pan.pan.setTargetAtTime(
        clamp(Number(track.panValue), -1, 1),
        now,
        0.025
      );
    }

    const musicControls = track.type === "music";

    if (musicControls) {
      const bassValue = Number(
        $("bassControl")?.value ?? 0
      );

      const midValue = Number(
        $("midControl")?.value ?? 0
      );

      const trebleValue = Number(
        $("trebleControl")?.value ?? 0
      );

      const distortionValue = Number(
        $("distortionControl")?.value ?? 0
      );

      const delayValue = Number(
        $("delayControl")?.value ?? 0
      );

      const reverbValue = Number(
        $("reverbControl")?.value ?? 0
      );

      track.bass.gain.setTargetAtTime(
        clamp(bassValue, -24, 24),
        now,
        0.025
      );

      track.mid.gain.setTargetAtTime(
        clamp(midValue, -24, 24),
        now,
        0.025
      );

      track.treble.gain.setTargetAtTime(
        clamp(trebleValue, -24, 24),
        now,
        0.025
      );

      track.distortion.curve =
        createDistortionCurve(distortionValue);

      track.distortionWet.gain.setTargetAtTime(
        clamp(distortionValue / 100, 0, 1),
        now,
        0.025
      );

      track.delayWet.gain.setTargetAtTime(
        clamp(delayValue / 100, 0, 0.8),
        now,
        0.025
      );

      track.reverbWet.gain.setTargetAtTime(
        clamp(reverbValue / 100, 0, 0.8),
        now,
        0.025
      );

      track.delay.delayTime.setTargetAtTime(
        0.15 + delayValue * 0.004,
        now,
        0.025
      );
    }

    updateMixerMeters();
  }

  function applyAllTrackSettings() {
    Object.values(state.tracks).forEach((track) => {
      applyTrackSettings(track);
    });
  }

  function getEffectiveVolume(track) {
    const anySolo = Object.values(state.tracks).some(
      (item) => item.solo
    );

    if (track.muted) {
      return 0;
    }

    if (anySolo && !track.solo) {
      return 0;
    }

    return clamp(track.volume, 0, 1.5);
  }

  function updateTrackMuteSoloGains() {
    Object.values(state.tracks).forEach((track) => {
      if (!track.gain || !state.audioContext) {
        return;
      }

      const target = getEffectiveVolume(track);

      track.gain.gain.setTargetAtTime(
        target,
        state.audioContext.currentTime,
        0.025
      );
    });

    updateTrackActionButtons();
  }

  /* -------------------------------------------------------
     AUDIO FILE IMPORT
     ------------------------------------------------------- */

  async function decodeAudioFile(file) {
    await ensureAudioContext();

    const arrayBuffer = await file.arrayBuffer();

    return await state.audioContext.decodeAudioData(
      arrayBuffer.slice(0)
    );
  }

  async function importAudioFile(file, targetType) {
    if (!file) return;

    if (
      !file.type.startsWith("audio/") &&
      !/\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|webm)$/i.test(
        file.name
      )
    ) {
      toast("Faayila audio filadhu.");
      return;
    }

    const type =
      targetType ||
      state.selectedTrack ||
      "music";

    const track = state.tracks[type];

    if (!track) {
      toast("Track sirrii filadhu.");
      return;
    }

    try {
      toast("Audio fe'amaa jira...");

      const buffer = await decodeAudioFile(file);

      stopPlayback();

      track.audio = {
        buffer,
        originalFile: file
      };

      track.duration = buffer.duration;
      track.trimStart = 0;
      track.trimEnd = buffer.duration;
      track.startOffset = 0;
      track.name = file.name;

      track.waveform = generateWaveformData(buffer);

      await ensureTrackGraph(track);

      drawTrackWaveform(type);

      updateAudioInformation();
      updateTimeline();
      updateMixerMeters();

      saveUndoState();

      setSaveStatus("Audio loaded");

      toast(
        "Audio milkaa'inaan fe'ame: " + file.name
      );

    } catch (error) {
      console.error(error);

      toast(
        "Audio fe'uun hin dandeenye. Faayila biraa yaali."
      );
    }
  }

  function generateWaveformData(buffer, points = 500) {
    const channel = buffer.getChannelData(0);
    const result = [];

    const step = Math.max(
      1,
      Math.floor(channel.length / points)
    );

    for (let i = 0; i < channel.length; i += step) {
      let max = 0;

      const end = Math.min(
        channel.length,
        i + step
      );

      for (let j = i; j < end; j++) {
        max = Math.max(max, Math.abs(channel[j]));
      }

      result.push(max);
    }

    return result;
  }

  /* -------------------------------------------------------
     AUDIO INFORMATION
     ------------------------------------------------------- */

  function getSelectedTrack() {
    return state.tracks[state.selectedTrack];
  }

  function getTrackDuration(track) {
    if (!track) return 0;

    if (track.trimEnd !== null) {
      return Math.max(
        0,
        track.trimEnd - track.trimStart
      );
    }

    return track.duration || 0;
  }

  function getProjectDuration() {
    return Math.max(
      0,
      ...Object.values(state.tracks).map((track) =>
        getTrackDuration(track)
      )
    );
  }

  function updateAudioInformation() {
    const track = getSelectedTrack();
    const available = hasAudio(track);

    setStatus(
      "currentTrackTitle",
      available ? track.name : "No audio selected"
    );

    setStatus(
      "audioFormat",
      available
        ? track.audio.buffer.numberOfChannels + " CH"
        : "No audio"
    );

    setStatus(
      "trackDurationText",
      formatTime(available ? getTrackDuration(track) : 0)
    );

    setStatus(
      "durationDisplay",
      formatTime(getProjectDuration())
    );

    setStatus(
      "audioStatus",
      available ? "Audio loaded" : "Waiting for audio"
    );

    setStatus(
      "playbackBadge",
      available ? "READY TO PLAY" : "NO AUDIO"
    );

    const selectedName = $("timelineTrackName");

    if (selectedName) {
      selectedName.textContent = track.name;
    }

    const waveformPlaceholder = $("emptyWaveform");

    if (waveformPlaceholder) {
      waveformPlaceholder.style.display =
        available ? "none" : "block";
    }
  }

  /* -------------------------------------------------------
     TIMELINE / CLIPS
     ------------------------------------------------------- */

  function updateTimeline() {
    const totalDuration = Math.max(
      1,
      getProjectDuration()
    );

    const trackIds = {
      music: "mainAudioClip",
      voice: "voiceAudioClip",
      keyboard: "keyboardAudioClip"
    };

    Object.entries(trackIds).forEach(([type, id]) => {
      const clip = $(id);
      const track = state.tracks[type];

      if (!clip) return;

      const available = hasAudio(track);

      clip.style.display = available ? "flex" : "none";

      if (available) {
        const clipDuration = getTrackDuration(track);

        clip.title = track.name;

        const name = clip.querySelector(
          ".clip-name, strong"
        );

        if (name) {
          name.textContent = track.name;
        }

        const widthPercent =
          (clipDuration / totalDuration) * 100;

        clip.style.width =
          clamp(widthPercent, 10, 100) + "%";
      }
    });

    const content = $("timelineContent");

    if (content) {
      content.style.minWidth =
        Math.max(680, 680 * state.zoom) + "px";
    }

    const zoomValue = $("zoomValue");

    if (zoomValue) {
      zoomValue.textContent =
        Math.round(state.zoom * 100) + "%";
    }

    updateAudioInformation();
  }

  function drawTrackWaveform(type) {
    const track = state.tracks[type];

    const canvas =
      type === "music"
        ? $("waveformCanvas")
        : document.querySelector(
            `[data-track-type="${type}"] canvas`
          );

    if (!canvas || !track.waveform) return;

    const rect = canvas.getBoundingClientRect();

    const width = Math.max(
      300,
      Math.floor(rect.width || 600)
    );

    const height = Math.max(
      24,
      Math.floor(rect.height || 30)
    );

    const dpr = Math.min(
      2,
      window.devicePixelRatio || 1
    );

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const color =
      type === "music"
        ? "#9a8cff"
        : type === "voice"
          ? "#43d9ff"
          : "#45e6a0";

    ctx.fillStyle = color;

    const data = track.waveform;
    const barWidth = width / data.length;

    data.forEach((value, index) => {
      const barHeight = Math.max(
        1,
        value * height * 0.92
      );

      ctx.fillRect(
        index * barWidth,
        (height - barHeight) / 2,
        Math.max(1, barWidth * 0.7),
        barHeight
      );
    });
  }

  function drawAllWaveforms() {
    Object.keys(state.tracks).forEach(
      drawTrackWaveform
    );
  }

  function updatePlayhead(time) {
    const playhead = $("playhead");

    if (!playhead) return;

    const duration = Math.max(
      1,
      getProjectDuration()
    );

    const timeline =
      $("timelineContent")?.getBoundingClientRect();

    if (!timeline) return;

    const leftOffset = 145;

    const usableWidth = Math.max(
      1,
      timeline.width - leftOffset
    );

    playhead.style.left =
      leftOffset +
      (clamp(time / duration, 0, 1) * usableWidth) +
      "px";
  }

  /* -------------------------------------------------------
     PLAYBACK
     ------------------------------------------------------- */

  function getPlaybackTime() {
    if (!state.isPlaying) {
      return state.playStartOffset;
    }

    return (
      state.playStartOffset +
      (performance.now() - state.playStartedAt) /
        1000 *
        state.playbackSpeed
    );
  }

  async function playTrack(track, projectTime) {
    if (!hasAudio(track)) return;

    const context = await ensureAudioContext();

    await ensureTrackGraph(track);

    const source = context.createBufferSource();

    source.buffer = track.audio.buffer;
    source.playbackRate.value = state.playbackSpeed;

    source.connect(track.source);

    const offset = clamp(
      track.trimStart + projectTime,
      track.trimStart,
      track.trimEnd ?? track.duration
    );

    const end = track.trimEnd ?? track.duration;
    const remaining = Math.max(0, end - offset);

    if (remaining <= 0) return;

    track.sourceStartOffset = offset;
    track.startedAt = context.currentTime;

    const trackGain = track.source;

    trackGain.gain.cancelScheduledValues(
      context.currentTime
    );

    trackGain.gain.setValueAtTime(
      1,
      context.currentTime
    );

    const fadeIn = Number(
      $("fadeInControl")?.value ?? 0
    );

    const fadeOut = Number(
      $("fadeOutControl")?.value ?? 0
    );

    if (fadeIn > 0) {
      const fadeSeconds = Math.min(
        fadeIn,
        remaining
      );

      trackGain.gain.setValueAtTime(
        0,
        context.currentTime
      );

      trackGain.gain.linearRampToValueAtTime(
        1,
        context.currentTime + fadeSeconds
      );
    }

    if (fadeOut > 0) {
      const fadeStart = Math.max(
        0,
        remaining - fadeOut
      );

      trackGain.gain.setValueAtTime(
        1,
        context.currentTime + fadeStart
      );

      trackGain.gain.linearRampToValueAtTime(
        0,
        context.currentTime + remaining
      );
    }

    source.start(
      0,
      offset,
      Math.min(remaining, track.duration - offset)
    );

    track.audioElement = source;

    source.onended = () => {
      if (track.audioElement === source) {
        track.audioElement = null;
      }
    };
  }

  async function startPlayback() {
    const projectDuration = getProjectDuration();

    if (projectDuration <= 0) {
      toast("Jalqaba audio upload godhi.");
      return;
    }

    try {
      await ensureAudioContext();

      stopPlayback(false);

      const startAt = clamp(
        state.playStartOffset,
        0,
        projectDuration
      );

      if (startAt >= projectDuration) {
        state.playStartOffset = 0;
      }

      state.isPlaying = true;
      state.playStartedAt = performance.now();

      Object.values(state.tracks).forEach((track) => {
        if (!hasAudio(track)) return;

        playTrack(track, state.playStartOffset)
          .catch((error) => {
            console.error("Track playback error:", error);
          });
      });

      updatePlaybackButtons();
      startPlaybackAnimation();

      setStatus("playbackBadge", "PLAYING");
      toast("Playback started");

    } catch (error) {
      console.error(error);

      toast(
        "Audio playback jalqabuun hin danda'amne."
      );
    }
  }

  function pausePlayback() {
    if (!state.isPlaying) return;

    state.playStartOffset = getPlaybackTime();

    stopPlaybackSources();

    state.isPlaying = false;

    cancelAnimationFrame(state.animationFrame);

    updatePlaybackButtons();
    setStatus("playbackBadge", "PAUSED");
  }

  function stopPlaybackSources() {
    Object.values(state.tracks).forEach((track) => {
      const source = track.audioElement;

      if (source && typeof source.stop === "function") {
        try {
          source.stop();
        } catch (_) {
          // Source may already have stopped.
        }
      }

      track.audioElement = null;
    });
  }

  function stopPlayback(resetTime = true) {
    stopPlaybackSources();

    state.isPlaying = false;

    if (resetTime) {
      state.playStartOffset = 0;
    }

    cancelAnimationFrame(state.animationFrame);

    updatePlaybackButtons();

    if (resetTime) {
      setStatus("timeDisplay", "00:00");
      updatePlayhead(0);
    }

    setStatus("playbackBadge", "STOPPED");
  }

  function togglePlayback() {
    if (state.isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }

  function startPlaybackAnimation() {
    cancelAnimationFrame(state.animationFrame);

    const frame = () => {
      if (!state.isPlaying) return;

      const time = getPlaybackTime();

      const duration = getProjectDuration();

      setStatus("timeDisplay", formatTime(time));

      const seekBar = $("seekBar");

      if (seekBar) {
        seekBar.max = duration || 1;
        seekBar.value = clamp(time, 0, duration);
      }

      updatePlayhead(time);
      drawVisualizer();
      drawAudioMeter();

      if (time >= duration) {
        stopPlayback();
        return;
      }

      state.animationFrame =
        requestAnimationFrame(frame);
    };

    state.animationFrame =
      requestAnimationFrame(frame);
  }

  function updatePlaybackButtons() {
    const playButton = $("playBtn");

    if (playButton) {
      playButton.textContent =
        state.isPlaying ? "Ⅱ" : "▶";

      playButton.setAttribute(
        "aria-label",
        state.isPlaying ? "Pause playback" : "Play audio"
      );
    }

    const playBadge = $("playbackBadge");

    if (playBadge && state.isPlaying) {
      playBadge.textContent = "PLAYING";
    }
  }

  function seekPlayback(value) {
    const duration = getProjectDuration();

    const target = clamp(
      Number(value) || 0,
      0,
      duration
    );

    state.playStartOffset = target;

    setStatus("timeDisplay", formatTime(target));
    updatePlayhead(target);

    if (state.isPlaying) {
      startPlayback();
    }
  }

  /* -------------------------------------------------------
     AUDIO EFFECT CONTROLS
     ------------------------------------------------------- */

  function updateRangeLabel(inputId, labelId, suffix = "") {
    const input = $(inputId);
    const label = $(labelId);

    if (!input || !label) return;

    label.textContent = input.value + suffix;
  }

  function bindRange(
    inputId,
    labelId,
    callback,
    suffix = ""
  ) {
    const input = $(inputId);

    if (!input) return;

    const update = () => {
      updateRangeLabel(inputId, labelId, suffix);

      if (callback) {
        callback(Number(input.value));
      }
    };

    input.addEventListener("input", update);
    input.addEventListener("change", update);

    update();
  }

  function bindEffectControls() {
    bindRange(
      "volumeControl",
      "volumeValue",
      (value) => {
        const track = state.tracks.music;

        track.volume = clamp(value / 100, 0, 1.5);

        applyTrackSettings(track);
        updateTrackMuteSoloGains();
      },
      "%"
    );

    bindRange(
      "bassControl",
      "bassValue",
      () => applyTrackSettings(state.tracks.music),
      " dB"
    );

    bindRange(
      "midControl",
      "midValue",
      () => applyTrackSettings(state.tracks.music),
      " dB"
    );

    bindRange(
      "trebleControl",
      "trebleValue",
      () => applyTrackSettings(state.tracks.music),
      " dB"
    );

    bindRange(
      "panControl",
      "panValue",
      (value) => {
        state.tracks.music.panValue = value / 100;

        applyTrackSettings(state.tracks.music);
      },
      ""
    );

    bindRange(
      "reverbControl",
      "reverbValue",
      () => applyTrackSettings(state.tracks.music),
      "%"
    );

    bindRange(
      "delayControl",
      "delayValue",
      () => applyTrackSettings(state.tracks.music),
      "%"
    );

    bindRange(
      "distortionControl",
      "distortionValue",
      () => applyTrackSettings(state.tracks.music),
      "%"
    );

    bindRange(
      "fadeInControl",
      "fadeInValue",
      null,
      " s"
    );

    bindRange(
      "fadeOutControl",
      "fadeOutValue",
      null,
      " s"
    );

    bindRange(
      "mixerVolume",
      "masterLevelText",
      (value) => {
        state.masterVolume = value / 100;

        if (state.masterGain && state.audioContext) {
          state.masterGain.gain.setTargetAtTime(
            state.masterVolume,
            state.audioContext.currentTime,
            0.025
          );
        }

        updateMixerMeters();
      },
      "%"
    );

    bindRange(
      "mixerTrackVolume",
      null,
      (value) => {
        state.tracks.music.volume =
          clamp(value / 100, 0, 1.5);

        applyTrackSettings(state.tracks.music);
        updateTrackMuteSoloGains();
      }
    );

    bindRange(
      "mixerPan",
      null,
      (value) => {
        state.tracks.music.panValue = value / 100;

        applyTrackSettings(state.tracks.music);
      }
    );

    bindRange(
      "voiceVolume",
      null,
      (value) => {
        state.tracks.voice.volume =
          clamp(value / 100, 0, 1.5);

        applyTrackSettings(state.tracks.voice);
        updateTrackMuteSoloGains();
      }
    );

    bindRange(
      "voicePan",
      null,
      (value) => {
        state.tracks.voice.panValue = value / 100;

        applyTrackSettings(state.tracks.voice);
      }
    );

    bindRange(
      "instrumentMixerVolume",
      null,
      (value) => {
        state.tracks.keyboard.volume =
          clamp(value / 100, 0, 1.5);

        applyTrackSettings(state.tracks.keyboard);
        updateTrackMuteSoloGains();
      }
    );

    bindRange(
      "instrumentMixerPan",
      null,
      (value) => {
        state.tracks.keyboard.panValue =
          value / 100;

        applyTrackSettings(state.tracks.keyboard);
      }
    );

    bindRange(
      "keyboardVolume",
      null,
      (value) => {
        state.tracks.keyboard.volume =
          clamp(value / 100, 0, 1.5);

        applyTrackSettings(state.tracks.keyboard);
        updateTrackMuteSoloGains();
      }
    );
  }

  /* -------------------------------------------------------
     PRESETS
     ------------------------------------------------------- */

  const presets = {
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
      mid: -1,
      treble: -2,
      reverb: 12,
      delay: 0,
      distortion: 2
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
      bass: 5,
      mid: 2,
      treble: 3,
      reverb: 4,
      delay: 8,
      distortion: 3
    },

    gospel: {
      bass: 2,
      mid: 1,
      treble: 3,
      reverb: 35,
      delay: 12,
      distortion: 0
    },

    studio: {
      bass: 1,
      mid: 1,
      treble: 2,
      reverb: 10,
      delay: 2,
      distortion: 0
    }
  };

  function applyPreset(name) {
    const preset = presets[name];

    if (!preset) return;

    const values = {
      bassControl: preset.bass,
      midControl: preset.mid,
      trebleControl: preset.treble,
      reverbControl: preset.reverb,
      delayControl: preset.delay,
      distortionControl: preset.distortion
    };

    Object.entries(values).forEach(([id, value]) => {
      const input = $(id);

      if (!input) return;

      input.value = value;
      input.dispatchEvent(
        new Event("input", { bubbles: true })
      );
    });

    state.activePreset = name;

    $$(".preset-button").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.preset === name
      );
    });

    setStatus(
      "presetStatus",
      "Preset applied: " + name
    );

    toast("Preset " + name + " applied");

    saveUndoState();
  }

  /* -------------------------------------------------------
     RESET / COMPARE
     ------------------------------------------------------- */

  function resetAdjustments() {
    const defaults = {
      volumeControl: 80,
      bassControl: 0,
      midControl: 0,
      trebleControl: 0,
      panControl: 0,
      reverbControl: 0,
      delayControl: 0,
      distortionControl: 0,
      fadeInControl: 0,
      fadeOutControl: 0
    };

    Object.entries(defaults).forEach(([id, value]) => {
      const input = $(id);

      if (!input) return;

      input.value = value;

      input.dispatchEvent(
        new Event("input", { bubbles: true })
      );
    });

    state.tracks.music.volume = 0.8;
    state.tracks.music.panValue = 0;

    applyTrackSettings(state.tracks.music);

    toast("Audio adjustments reset");
  }

  function toggleCompare() {
    state.comparingOriginal =
      !state.comparingOriginal;

    const button = $("compareBtn");

    if (button) {
      button.textContent =
        state.comparingOriginal
          ? "Return to Effects"
          : "Compare Original";
    }

    if (state.comparingOriginal) {
      setStatus(
        "compareStatus",
        "Original comparison active"
      );

      const track = state.tracks.music;

      if (track.bass && state.audioContext) {
        const now = state.audioContext.currentTime;

        track.bass.gain.setTargetAtTime(0, now, 0.02);
        track.mid.gain.setTargetAtTime(0, now, 0.02);
        track.treble.gain.setTargetAtTime(0, now, 0.02);

        track.distortionWet.gain.setTargetAtTime(
          0,
          now,
          0.02
        );

        track.delayWet.gain.setTargetAtTime(
          0,
          now,
          0.02
        );

        track.reverbWet.gain.setTargetAtTime(
          0,
          now,
          0.02
        );
      }
    } else {
      applyTrackSettings(state.tracks.music);

      setStatus(
        "compareStatus",
        "Effects restored"
      );
    }
  }

  /* -------------------------------------------------------
     TRACK MUTE / SOLO
     ------------------------------------------------------- */

  function updateTrackActionButtons() {
    $$("[data-track-action]").forEach((button) => {
      const type = button.dataset.track;
      const action = button.dataset.trackAction;
      const track = state.tracks[type];

      if (!track) return;

      const active =
        action === "mute"
          ? track.muted
          : action === "solo"
            ? track.solo
            : false;

      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed",
        active ? "true" : "false"
      );
    });
  }

  function toggleTrackAction(type, action) {
    const track = state.tracks[type];

    if (!track) return;

    if (action === "mute") {
      track.muted = !track.muted;
    } else if (action === "solo") {
      track.solo = !track.solo;
    }

    updateTrackMuteSoloGains();
  }

  /* -------------------------------------------------------
     VOICE RECORDING
     ------------------------------------------------------- */

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast(
        "Microphone hin deeggaramu. HTTPS website irratti yaali."
      );
      return;
    }

    if (!window.MediaRecorder) {
      toast(
        "Browseriin kee audio recording hin deeggaru."
      );
      return;
    }

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

      state.mediaStream = stream;
      state.recordingChunks = [];

      let options = {};

      if (
        MediaRecorder.isTypeSupported(
          "audio/webm;codecs=opus"
        )
      ) {
        options.mimeType = "audio/webm;codecs=opus";
      }

      state.mediaRecorder =
        new MediaRecorder(stream, options);

      state.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          state.recordingChunks.push(event.data);
        }
      };

      state.mediaRecorder.onstop = () => {
        const mimeType =
          state.mediaRecorder?.mimeType ||
          "audio/webm";

        const blob = new Blob(
          state.recordingChunks,
          { type: mimeType }
        );

        if (state.currentRecordingUrl) {
          URL.revokeObjectURL(
            state.currentRecordingUrl
          );
        }

        state.currentRecordingUrl =
          URL.createObjectURL(blob);

        const preview = $("recordingPreview");

        if (preview) {
          preview.src = state.currentRecordingUrl;
          preview.load();
        }

        setStatus(
          "recordingResultStatus",
          "Recording ready"
        );

        const result = $("recordingResult");

        if (result) {
          result.classList.remove("hidden");
        }

        stopMicrophoneTracks();

        toast("Recording finished");
      };

      state.mediaRecorder.start(250);

      state.recordingStartedAt = Date.now();
      state.recordingElapsedBeforePause = 0;
      state.recordingPaused = false;

      setRecordingState("Recording");

      clearInterval(state.recordingTimer);

      state.recordingTimer = setInterval(
        updateRecordingTimer,
        250
      );

      startRecordingVisualizer(stream);

      updateRecordingButtons();

    } catch (error) {
      console.error(error);

      toast(
        "Microphone hayyama hin arganne. Browser settings ilaali."
      );
    }
  }

  function updateRecordingTimer() {
    if (
      !state.recordingStartedAt ||
      state.recordingPaused
    ) {
      return;
    }

    const elapsed =
      state.recordingElapsedBeforePause +
      (Date.now() - state.recordingStartedAt) / 1000;

    setStatus(
      "recordingTimer",
      formatTime(elapsed)
    );
  }

  function setRecordingState(message) {
    setStatus("recordingState", message);

    const orb = $("recordingOrb");

    if (orb) {
      orb.classList.toggle(
        "recording",
        message === "Recording"
      );
    }
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

    state.recordingPaused = true;

    state.mediaRecorder.pause();

    clearInterval(state.recordingTimer);

    setRecordingState("Paused");
    updateRecordingButtons();
  }

  function resumeVoiceRecording() {
    if (
      !state.mediaRecorder ||
      state.mediaRecorder.state !== "paused"
    ) {
      return;
    }

    state.recordingStartedAt = Date.now();
    state.recordingPaused = false;

    state.mediaRecorder.resume();

    clearInterval(state.recordingTimer);

    state.recordingTimer = setInterval(
      updateRecordingTimer,
      250
    );

    setRecordingState("Recording");
    updateRecordingButtons();
  }

  function stopVoiceRecording() {
    if (
      !state.mediaRecorder ||
      state.mediaRecorder.state === "inactive"
    ) {
      toast("Recording hin jalqabne.");
      return;
    }

    clearInterval(state.recordingTimer);

    state.mediaRecorder.stop();

    setRecordingState("Finished");

    updateRecordingButtons();
  }

  function stopMicrophoneTracks() {
    if (state.mediaStream) {
      state.mediaStream
        .getTracks()
        .forEach((track) => track.stop());

      state.mediaStream = null;
    }
  }

  function updateRecordingButtons() {
    const recorder = state.mediaRecorder;

    const active =
      recorder && recorder.state === "recording";

    const paused =
      recorder && recorder.state === "paused";

    const start = $("recordBtn");
    const pause = $("pauseRecordBtn");
    const resume = $("resumeRecordBtn");
    const stop = $("stopRecordBtn");

    if (start) start.disabled = Boolean(active || paused);
    if (pause) pause.disabled = !active;
    if (resume) resume.disabled = !paused;
    if (stop) stop.disabled = !(active || paused);
  }

  function startRecordingVisualizer(stream) {
    const canvas = $("recordingWaveform");

    if (!canvas || !state.audioContext) return;

    const context = state.audioContext;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    analyser.fftSize = 1024;

    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);

    const draw = () => {
      if (!state.mediaStream) return;

      const ctx = canvas.getContext("2d");

      if (!ctx) return;

      const width = canvas.width =
        Math.max(300, canvas.clientWidth || 600);

      const height = canvas.height =
        Math.max(50, canvas.clientHeight || 90);

      analyser.getByteTimeDomainData(data);

      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = "#43d9ff";
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let i = 0; i < data.length; i++) {
        const x = (i / data.length) * width;
        const y = (data[i] / 255) * height;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();

      if (state.mediaStream) {
        requestAnimationFrame(draw);
      }

      try {
        source.connect(analyser);
      } catch (_) {
        // Already connected.
      }
    };

    draw();
  }

  async function addVoiceRecordingToTimeline() {
    if (!state.currentRecordingUrl) {
      toast("Jalqaba sagalee waraabi.");
      return;
    }

    try {
      const response = await fetch(
        state.currentRecordingUrl
      );

      const blob = await response.blob();

      const file = new File(
        [blob],
        "Naol_Voice_Recording.webm",
        { type: blob.type || "audio/webm" }
      );

      await importAudioFile(file, "voice");

      const section = $("editorSection");

      if (section) {
        showSection("editorSection");
      }

    } catch (error) {
      console.error(error);
      toast("Recording timeline irratti dabaluu hin dandeenye.");
    }
  }

  function downloadVoiceRecording() {
    if (!state.currentRecordingUrl) {
      toast("Recording hin jiru.");
      return;
    }

    downloadUrl(
      state.currentRecordingUrl,
      "Naol_Voice_Recording.webm"
    );
  }

  function discardVoiceRecording() {
    if (state.currentRecordingUrl) {
      URL.revokeObjectURL(
        state.currentRecordingUrl
      );

      state.currentRecordingUrl = null;
    }

    const preview = $("recordingPreview");

    if (preview) {
      preview.removeAttribute("src");
      preview.load();
    }

    const result = $("recordingResult");

    if (result) {
      result.classList.add("hidden");
    }

    setStatus(
      "recordingResultStatus",
      "No recording"
    );

    toast("Recording discarded");
  }

  /* -------------------------------------------------------
     VIRTUAL KEYBOARD
     ------------------------------------------------------- */

  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B"
  ];

  function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function getInstrumentType() {
    return $("instrumentSelect")?.value || "piano";
  }

  function getKeyboardOctave() {
    return Number(
      $("octaveSelect")?.value || 4
    );
  }

  function renderVirtualKeyboard() {
    const container = $("pianoKeyboard");

    if (!container) return;

    container.innerHTML = "";

    const octave = getKeyboardOctave();

    const startMidi = (octave + 1) * 12;

    for (let i = 0; i < 24; i++) {
      const midi = startMidi + i;
      const note = noteNames[midi % 12];

      const black = note.includes("#");

      const button = document.createElement("button");

      button.type = "button";

      button.className =
        "piano-key " +
        (black ? "black-key" : "white-key");

      button.dataset.midi = String(midi);

      button.setAttribute(
        "aria-label",
        note + " " + Math.floor(midi / 12 - 1)
      );

      const label = document.createElement("span");

      label.className = "piano-key-label";
      label.textContent =
        note +
        (note.includes("#") ? "" : "");

      button.appendChild(label);

      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();

        button.setPointerCapture?.(event.pointerId);

        startKeyboardNote(midi, button);
      });

      const stopNote = () => {
        stopKeyboardNote(midi, button);
      };

      button.addEventListener("pointerup", stopNote);
      button.addEventListener("pointercancel", stopNote);
      button.addEventListener("lostpointercapture", stopNote);

      container.appendChild(button);
    }
  }

  async function startKeyboardNote(midi, button) {
    if (state.heldKeyboardNotes.has(midi)) return;

    try {
      const context = await ensureAudioContext();

      const track = state.tracks.keyboard;

      await ensureTrackGraph(track);

      const instrument = getInstrumentType();

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.frequency.value =
        midiToFrequency(midi);

      if (instrument === "bass") {
        oscillator.type = "triangle";
      } else if (instrument === "electric") {
        oscillator.type = "square";
      } else if (instrument === "synth") {
        oscillator.type = "sawtooth";
      } else {
        oscillator.type = "triangle";
      }

      const now = context.currentTime;

      const noteGain =
        instrument === "bass"
          ? 0.13
          : instrument === "synth"
            ? 0.09
            : 0.12;

      gain.gain.setValueAtTime(0.0001, now);

      gain.gain.exponentialRampToValueAtTime(
        noteGain,
        now + 0.025
      );

      oscillator.connect(gain);
      gain.connect(track.source);

      oscillator.start(now);

      state.heldKeyboardNotes.set(midi, {
        oscillator,
        gain,
        startedAt: now,
        button
      });

      button?.classList.add("active");

      if (state.keyboardIsRecording) {
        state.keyboardRecording.push({
          midi,
          start:
            getKeyboardRecordingTime(),
          end: null
        });
      }

      setStatus(
        "keyboardStatus",
        "Playing " + noteNames[midi % 12]
      );

    } catch (error) {
      console.error(error);
      toast("Keyboard sound jalqabuu hin dandeenye.");
    }
  }

  function stopKeyboardNote(midi, button) {
    const note = state.heldKeyboardNotes.get(midi);

    if (!note) return;

    const context = state.audioContext;
    const now = context ? context.currentTime : 0;

    try {
      const sustainEnabled =
        $("sustainBtn")?.classList.contains("active");

      const release = sustainEnabled ? 0.7 : 0.15;

      note.gain.gain.cancelScheduledValues(now);

      note.gain.gain.setTargetAtTime(
        0.0001,
        now,
        release / 5
      );

      note.oscillator.stop(now + release);

    } catch (_) {
      // Oscillator may already have stopped.
    }

    const lastNote =
      [...state.keyboardRecording]
        .reverse()
        .find(
          (item) =>
            item.midi === midi &&
            item.end === null
        );

    if (lastNote) {
      lastNote.end = getKeyboardRecordingTime();
    }

    state.heldKeyboardNotes.delete(midi);

    button?.classList.remove("active");
  }

  function getKeyboardRecordingTime() {
    if (!state.keyboardIsRecording) return 0;

    const elapsed =
      Date.now() -
      state.keyboardRecordingStartedAt -
      state.keyboardRecordingPauseTotal;

    return Math.max(0, elapsed / 1000);
  }

  function stopAllKeyboardNotes() {
    [...state.heldKeyboardNotes.keys()].forEach((midi) => {
      const note = state.heldKeyboardNotes.get(midi);

      stopKeyboardNote(midi, note?.button);
    });
  }

  function bindComputerKeyboard() {
    const keyMap = {
      a: 0,
      w: 1,
      s: 2,
      e: 3,
      d: 4,
      f: 5,
      t: 6,
      g: 7,
      y: 8,
      h: 9,
      u: 10,
      j: 11,
      k: 12
    };

    const heldComputerKeys = new Map();

    window.addEventListener("keydown", (event) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const offset = keyMap[event.key.toLowerCase()];

      if (offset === undefined) return;

      const midi =
        (getKeyboardOctave() + 1) * 12 + offset;

      const button = $(
        "pianoKeyboard"
      )?.querySelector(`[data-midi="${midi}"]`);

      if (heldComputerKeys.has(event.key)) return;

      heldComputerKeys.set(event.key, midi);

      startKeyboardNote(midi, button);
    });

    window.addEventListener("keyup", (event) => {
      const midi = heldComputerKeys.get(event.key);

      if (midi === undefined) return;

      const button = $("pianoKeyboard")?.querySelector(
        `[data-midi="${midi}"]`
      );

      stopKeyboardNote(midi, button);

      heldComputerKeys.delete(event.key);
    });

    window.addEventListener("blur", () => {
      heldComputerKeys.forEach((midi) => {
        const button = $("pianoKeyboard")?.querySelector(
          `[data-midi="${midi}"]`
        );

        stopKeyboardNote(midi, button);
      });

      heldComputerKeys.clear();
    });
  }

  /* -------------------------------------------------------
     KEYBOARD PERFORMANCE RECORDING
     ------------------------------------------------------- */

  function startKeyboardRecording() {
    state.keyboardRecording = [];

    state.keyboardRecordingStartedAt = Date.now();
    state.keyboardRecordingPauseTotal = 0;

    state.keyboardIsRecording = true;
    state.keyboardIsPaused = false;

    setStatus(
      "keyboardStatus",
      "Recording keyboard performance"
    );

    updateKeyboardRecordingButtons();

    toast("Keyboard recording started");
  }

  function pauseKeyboardRecording() {
    if (
      !state.keyboardIsRecording ||
      state.keyboardIsPaused
    ) {
      return;
    }

    state.keyboardIsPaused = true;
    state.keyboardRecordingPausedAt = Date.now();

    updateKeyboardRecordingButtons();

    setStatus(
      "keyboardStatus",
      "Keyboard recording paused"
    );
  }

  function resumeKeyboardRecording() {
    if (
      !state.keyboardIsRecording ||
      !state.keyboardIsPaused
    ) {
      return;
    }

    state.keyboardRecordingPauseTotal +=
      Date.now() - state.keyboardRecordingPausedAt;

    state.keyboardIsPaused = false;

    updateKeyboardRecordingButtons();

    setStatus(
      "keyboardStatus",
      "Recording keyboard performance"
    );
  }

  function stopKeyboardRecording() {
    if (!state.keyboardIsRecording) {
      toast("Keyboard recording hin jalqabne.");
      return;
    }

    stopAllKeyboardNotes();

    state.keyboardIsRecording = false;
    state.keyboardIsPaused = false;

    updateKeyboardRecordingButtons();

    setStatus(
      "keyboardStatus",
      "Keyboard performance recorded"
    );

    toast("Keyboard performance saved in memory");
  }

  function updateKeyboardRecordingButtons() {
    const recording = state.keyboardIsRecording;
    const paused = state.keyboardIsPaused;

    const start = $("recordKeyboardBtn");
    const pause = $("pauseKeyboardBtn");
    const resume = $("resumeKeyboardBtn");
    const stop = $("stopKeyboardBtn");

    if (start) start.disabled = recording;
    if (pause) pause.disabled = !recording || paused;
    if (resume) resume.disabled = !recording || !paused;
    if (stop) stop.disabled = !recording;
  }

  function synthesizeKeyboardPerformance() {
    const notes = state.keyboardRecording.filter(
      (note) =>
        Number.isFinite(note.midi) &&
        Number.isFinite(note.start)
    );

    if (notes.length === 0) {
      toast("Keyboard recording keessatti note hin jiru.");
      return null;
    }

    const sampleRate = 44100;

    const duration = Math.max(
      0.5,
      ...notes.map((note) =>
        Math.max(
          note.start + 0.25,
          (note.end ?? note.start + 0.5)
        )
      )
    ) + 0.5;

    const frames = Math.ceil(duration * sampleRate);

    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    notes.forEach((note) => {
      const start = Math.floor(
        note.start * sampleRate
      );

      const end = Math.floor(
        Math.max(
          note.start + 0.12,
          note.end ?? note.start + 0.5
        ) * sampleRate
      );

      const frequency = midiToFrequency(note.midi);

      const attack = Math.floor(sampleRate * 0.015);
      const release = Math.floor(sampleRate * 0.12);

      const actualEnd = Math.min(frames, end + release);

      for (let i = start; i < actualEnd; i++) {
        const local = i - start;

        let envelope = 1;

        if (local < attack) {
          envelope = local / attack;
        }

        if (i > end) {
          envelope = Math.min(
            envelope,
            Math.max(0, 1 - (i - end) / release)
          );
        }

        const time = local / sampleRate;

        const sample =
          (
            Math.sin(2 * Math.PI * frequency * time) * 0.65 +
            Math.sin(4 * Math.PI * frequency * time) * 0.18 +
            Math.sin(6 * Math.PI * frequency * time) * 0.06
          ) *
          envelope *
          0.22;

        left[i] += sample;
        right[i] += sample;
      }
    });

    return createWavBlob(left, right, sampleRate);
  }

  async function playKeyboardRecording() {
    const blob = synthesizeKeyboardPerformance();

    if (!blob) return;

    if (state.currentKeyboardUrl) {
      URL.revokeObjectURL(state.currentKeyboardUrl);
    }

    state.currentKeyboardUrl = URL.createObjectURL(blob);

    const audio = new Audio(state.currentKeyboardUrl);

    audio.play().catch((error) => {
      console.error(error);
      toast("Keyboard recording play hin taane.");
    });
  }

  async function addKeyboardRecordingToTimeline() {
    const blob = synthesizeKeyboardPerformance();

    if (!blob) return;

    const file = new File(
      [blob],
      "Naol_Keyboard_Performance.wav",
      { type: "audio/wav" }
    );

    await importAudioFile(file, "keyboard");

    showSection("editorSection");
  }

  function downloadKeyboardRecording() {
    const blob = synthesizeKeyboardPerformance();

    if (!blob) return;

    downloadBlob(
      blob,
      "Naol_Keyboard_Performance.wav"
    );
  }

  /* -------------------------------------------------------
     WAV ENCODER
     ------------------------------------------------------- */

  function createWavBlob(left, right, sampleRate = 44100) {
    const channels = right ? 2 : 1;

    const length = left.length;
    const bytesPerSample = 2;

    const blockAlign = channels * bytesPerSample;
    const dataSize = length * blockAlign;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, text) {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }

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

    for (let i = 0; i < length; i++) {
      const l = clamp(left[i] || 0, -1, 1);

      view.setInt16(
        offset,
        l < 0
          ? l * 32768
          : l * 32767,
        true
      );

      offset += 2;

      if (channels === 2) {
        const r = clamp(right[i] || 0, -1, 1);

        view.setInt16(
          offset,
          r < 0
            ? r * 32768
            : r * 32767,
          true
        );

        offset += 2;
      }
    }

    return new Blob(
      [buffer],
      { type: "audio/wav" }
    );
  }

  /* -------------------------------------------------------
     OFFLINE AUDIO MIX / EXPORT
     ------------------------------------------------------- */

  async function renderOfflineMix() {
    const tracks = Object.values(state.tracks).filter(
      (track) => hasAudio(track)
    );

    if (tracks.length === 0) {
      throw new Error(
        "Jalqaba audio track tokko ol fe'i."
      );
    }

    const duration = getProjectDuration();

    if (duration <= 0) {
      throw new Error("Audio duration sirrii miti.");
    }

    const sampleRate = Number(
      $("exportSampleRate")?.value || 44100
    );

    const channels =
      $("exportChannels")?.value === "mono"
        ? 1
        : 2;

    const frames = Math.ceil(duration * sampleRate);

    const left = new Float32Array(frames);
    const right =
      channels === 2
        ? new Float32Array(frames)
        : null;

    const masterVolume = state.masterVolume;

    const settings = {
      bass: Number($("bassControl")?.value || 0),
      mid: Number($("midControl")?.value || 0),
      treble: Number($("trebleControl")?.value || 0),
      distortion: Number(
        $("distortionControl")?.value || 0
      ),
      delay: Number($("delayControl")?.value || 0),
      reverb: Number($("reverbControl")?.value || 0),
      fadeIn: Number($("fadeInControl")?.value || 0),
      fadeOut: Number($("fadeOutControl")?.value || 0)
    };

    const anySolo = tracks.some((track) => track.solo);

    for (const track of tracks) {
      if (track.muted || (anySolo && !track.solo)) {
        continue;
      }

      const buffer = track.audio.buffer;

      const leftChannel = buffer.getChannelData(0);

      const rightChannel =
        buffer.numberOfChannels > 1
          ? buffer.getChannelData(1)
          : leftChannel;

      const volume = clamp(
        track.volume,
        0,
        1.5
      );

      const pan = clamp(
        track.panValue,
        -1,
        1
      );

      const panLeft = Math.cos(
        (pan + 1) * Math.PI / 4
      );

      const panRight = Math.sin(
        (pan + 1) * Math.PI / 4
      );

      const startTime = track.trimStart || 0;

      const endTime =
        track.trimEnd ?? buffer.duration;

      const trackDuration = Math.max(
        0,
        endTime - startTime
      );

      const startFrame = 0;

      const framesForTrack = Math.min(
        frames,
        Math.ceil(trackDuration * sampleRate)
      );

      const bassGain = Math.pow(
        10,
        settings.bass / 20
      );

      const midGain = Math.pow(
        10,
        settings.mid / 20
      );

      const trebleGain = Math.pow(
        10,
        settings.treble / 20
      );

      let previousX = 0;
      let previousY = 0;

      for (let i = startFrame; i < framesForTrack; i++) {
        const sourceTime =
          startTime + i / sampleRate;

        const sourceIndex = Math.floor(
          sourceTime * buffer.sampleRate
        );

        if (sourceIndex >= leftChannel.length) {
          break;
        }

        let sampleL = leftChannel[sourceIndex];
        let sampleR = rightChannel[sourceIndex];

        /*
          Simple offline tone shaping.
          Live playback uses the Web Audio filter chain.
        */

        const bassFiltered =
          sampleL * (bassGain > 1 ? bassGain : 1);

        const trebleFiltered =
          sampleR * (trebleGain > 1 ? trebleGain : 1);

        sampleL =
          sampleL * 0.7 +
          bassFiltered * 0.15 +
          sampleL * midGain * 0.15;

        sampleR =
          sampleR * 0.7 +
          trebleFiltered * 0.15 +
          sampleR * midGain * 0.15;

        if (settings.distortion > 0) {
          const drive =
            1 + settings.distortion / 12;

          sampleL = Math.tanh(sampleL * drive);
          sampleR = Math.tanh(sampleR * drive);
        }

        /*
          Fade in/out is applied according to each track's
          duration, so exported audio follows the fade controls.
        */

        if (settings.fadeIn > 0) {
          const fadeInGain = clamp(
            (i / sampleRate) / settings.fadeIn,
            0,
            1
          );

          sampleL *= fadeInGain;
          sampleR *= fadeInGain;
        }

        if (settings.fadeOut > 0) {
          const remaining =
            trackDuration - i / sampleRate;

          const fadeOutGain = clamp(
            remaining / settings.fadeOut,
            0,
            1
          );

          sampleL *= fadeOutGain;
          sampleR *= fadeOutGain;
        }

        /*
          Add a light echo approximation to the mix.
        */

        const echoFrames = Math.floor(
          (0.15 + settings.delay * 0.004) *
          sampleRate
        );

        let echoL = 0;
        let echoR = 0;

        if (settings.delay > 0 && i > echoFrames) {
          echoL =
            left[i - echoFrames] *
            (settings.delay / 100) *
            0.25;

          if (right) {
            echoR =
              right[i - echoFrames] *
              (settings.delay / 100) *
              0.25;
          }
        }

        const targetIndex = Math.floor(
          (i / sampleRate) * sampleRate
        );

        if (targetIndex >= frames) break;

        left[targetIndex] +=
          (sampleL * panLeft * volume + echoL) *
          masterVolume;

        if (right) {
          right[targetIndex] +=
            (sampleR * panRight * volume + echoR) *
            masterVolume;
        }

        previousX = sampleL;
        previousY = sampleR;
      }
    }

    /*
      Optional peak normalization.
    */

    if ($("normalizeExport")?.checked) {
      let peak = 0;

      for (let i = 0; i < frames; i++) {
        peak = Math.max(
          peak,
          Math.abs(left[i]),
          right ? Math.abs(right[i]) : 0
        );
      }

      if (peak > 0) {
        const normalizationGain = 0.98 / peak;

        for (let i = 0; i < frames; i++) {
          left[i] *= normalizationGain;

          if (right) {
            right[i] *= normalizationGain;
          }
        }
      }
    } else {
      /*
        Soft safety limiter to prevent harsh clipping.
      */

      for (let i = 0; i < frames; i++) {
        left[i] = Math.tanh(left[i]);

        if (right) {
          right[i] = Math.tanh(right[i]);
        }
      }
    }

    return createWavBlob(left, right, sampleRate);
  }

  async function exportAudio() {
    const button = $("exportBtn");

    if (button) {
      button.disabled = true;
      button.textContent = "Rendering...";
    }

    const progressWrap = $("exportProgressWrap");

    if (progressWrap) {
      progressWrap.classList.add("visible");
    }

    setStatus("exportStatus", "Rendering audio mix...");

    updateExportProgress(5, "Preparing audio...");

    try {
      await new Promise((resolve) =>
        setTimeout(resolve, 30)
      );

      updateExportProgress(20, "Mixing tracks...");

      const blob = await renderOfflineMix();

      updateExportProgress(90, "Preparing WAV file...");

      state.exportBlob = blob;

      if (state.currentExportUrl) {
        URL.revokeObjectURL(state.currentExportUrl);
      }

      state.currentExportUrl =
        URL.createObjectURL(blob);

      updateExportProgress(100, "Export complete");

      const format = $("exportFormat")?.value || "wav";

      if (format === "mp3") {
        setStatus(
          "exportStatus",
          "MP3 encoder is unavailable. Exported a WAV file instead."
        );

        toast(
          "MP3 encoder hin jiru; WAV dhugaa export godhame."
        );
      } else {
        setStatus(
          "exportStatus",
          "WAV export complete"
        );

        toast("Audio export milkaa'e.");
      }

      const downloadButton = $("downloadExportBtn");

      if (downloadButton) {
        downloadButton.disabled = false;
      }

      setSaveStatus("Export ready");

    } catch (error) {
      console.error(error);

      setStatus(
        "exportStatus",
        error.message || "Export failed"
      );

      toast(
        error.message || "Audio export hin milkoofne."
      );

    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Export Audio";
      }
    }
  }

  function updateExportProgress(percent, message) {
    const value = clamp(percent, 0, 100);

    setStatus("exportProgressText", message);
    setStatus("exportProgressPercent", value + "%");

    const progress = $("exportProgress");

    if (progress) {
      progress.style.width = value + "%";
    }
  }

  function downloadExport() {
    if (!state.exportBlob) {
      toast("Jalqaba export audio godhi.");
      return;
    }

    const filename =
      ($("exportFileName")?.value || "Naol_Mix")
        .trim()
        .replace(/[<>:"/\\|?*]+/g, "_") ||
      "Naol_Mix";

    /*
      The output is WAV even if MP3 was requested
      but no MP3 encoder is installed.
    */

    downloadBlob(
      state.exportBlob,
      filename + ".wav"
    );
  }

  /* -------------------------------------------------------
     DOWNLOAD HELPERS
     ------------------------------------------------------- */

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);

    downloadUrl(url, filename);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 15000);
  }

  function downloadUrl(url, filename) {
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /* -------------------------------------------------------
     TRACK EDITING
     ------------------------------------------------------- */

  function splitSelectedTrack() {
    const track = getSelectedTrack();

    if (!hasAudio(track)) {
      toast("Audio track tokko filadhu.");
      return;
    }

    const splitAt = state.playStartOffset;

    const start = track.trimStart;
    const end = track.trimEnd ?? track.duration;

    if (
      splitAt <= 0 ||
      splitAt >= end - start
    ) {
      toast(
        "Split gochuuf playhead audio gidduutti kaa'i."
      );
      return;
    }

    /*
      The current single-track model retains the left portion.
      The full decoded buffer remains available for export.
      The right portion can be selected by adjusting trim start.
    */

    track.trimEnd = start + splitAt;

    updateTimeline();
    updateAudioInformation();

    saveUndoState();

    toast(
      "Audio segment qoodame. Kutaa itti aanuuf trim start sirreessi."
    );
  }

  function trimTrackStart() {
    const track = getSelectedTrack();

    if (!hasAudio(track)) {
      toast("Jalqaba audio upload godhi.");
      return;
    }

    const offset = state.playStartOffset;

    const absoluteTime =
      track.trimStart + offset;

    const end = track.trimEnd ?? track.duration;

    if (absoluteTime >= end) {
      toast("Trim start iddoo sirrii miti.");
      return;
    }

    track.trimStart = clamp(
      absoluteTime,
      0,
      end
    );

    state.playStartOffset = 0;

    updateTimeline();
    updateAudioInformation();

    saveUndoState();

    toast("Audio start trimmed");
  }

  function trimTrackEnd() {
    const track = getSelectedTrack();

    if (!hasAudio(track)) {
      toast("Jalqaba audio upload godhi.");
      return;
    }

    const absoluteTime =
      track.trimStart + state.playStartOffset;

    if (absoluteTime <= track.trimStart) {
      toast("Playhead gara dhuma audio geessi.");
      return;
    }

    track.trimEnd = clamp(
      absoluteTime,
      track.trimStart,
      track.duration
    );

    updateTimeline();
    updateAudioInformation();

    saveUndoState();

    toast("Audio end trimmed");
  }

  function deleteSelectedAudio() {
    const track = getSelectedTrack();

    if (!hasAudio(track)) {
      toast("Audio delete gochuuf hin jiru.");
      return;
    }

    track.audio = null;
    track.waveform = null;
    track.duration = 0;
    track.trimStart = 0;
    track.trimEnd = null;
    track.startOffset = 0;
    track.name =
      track.type === "music"
        ? "Music Track"
        : track.type === "voice"
          ? "Voice Track"
          : "Keyboard Track";

    if (track.audioElement) {
      try {
        track.audioElement.stop();
      } catch (_) {
        // Already stopped.
      }

      track.audioElement = null;
    }

    updateTimeline();
    updateAudioInformation();

    saveUndoState();

    toast("Selected audio deleted");
  }

  function selectTrack(type) {
    if (!state.tracks[type]) return;

    state.selectedTrack = type;

    updateAudioInformation();

    drawTrackWaveform(type);

    updateTimeline();

    setStatus(
      "currentTrackTitle",
      state.tracks[type].name
    );
  }

  function addEmptyTrack() {
    const availableTypes = [
      "music",
      "voice",
      "keyboard"
    ];

    const emptyType = availableTypes.find(
      (type) => !hasAudio(state.tracks[type])
    );

    if (emptyType) {
      selectTrack(emptyType);

      toast(
        emptyType + " track filatame. Amma audio itti fe'i."
      );
    } else {
      toast(
        "Track sadan isaanii jiru. Track tokko qulqulleessi."
      );
    }
  }

  /* -------------------------------------------------------
     UNDO / REDO
     ------------------------------------------------------- */

  function getSnapshot() {
    return {
      selectedTrack: state.selectedTrack,
      masterVolume: state.masterVolume,

      tracks: Object.fromEntries(
        Object.entries(state.tracks).map(([type, track]) => [
          type,
          {
            name: track.name,
            volume: track.volume,
            panValue: track.panValue,
            muted: track.muted,
            solo: track.solo,
            trimStart: track.trimStart,
            trimEnd: track.trimEnd,
            duration: track.duration
          }
        ])
      ),

      controls: {
        volumeControl: $("volumeControl")?.value,
        bassControl: $("bassControl")?.value,
        midControl: $("midControl")?.value,
        trebleControl: $("trebleControl")?.value,
        panControl: $("panControl")?.value,
        reverbControl: $("reverbControl")?.value,
        delayControl: $("delayControl")?.value,
        distortionControl: $("distortionControl")?.value,
        fadeInControl: $("fadeInControl")?.value,
        fadeOutControl: $("fadeOutControl")?.value
      }
    };
  }

  function saveUndoState() {
    try {
      const snapshot = getSnapshot();

      state.undoStack.push(
        JSON.stringify(snapshot)
      );

      if (state.undoStack.length > 40) {
        state.undoStack.shift();
      }

      state.redoStack.length = 0;
    } catch (error) {
      console.warn("Could not save undo state", error);
    }
  }

  function restoreSnapshot(json) {
    let snapshot;

    try {
      snapshot = JSON.parse(json);
    } catch (_) {
      return;
    }

    state.selectedTrack =
      snapshot.selectedTrack || "music";

    state.masterVolume =
      snapshot.masterVolume ?? 0.8;

    Object.entries(snapshot.tracks || {}).forEach(
      ([type, saved]) => {
        const track = state.tracks[type];

        if (!track) return;

        track.name = saved.name;
        track.volume = saved.volume;
        track.panValue = saved.panValue;
        track.muted = saved.muted;
        track.solo = saved.solo;
        track.trimStart = saved.trimStart;
        track.trimEnd = saved.trimEnd;
      }
    );

    Object.entries(snapshot.controls || {}).forEach(
      ([id, value]) => {
        const input = $(id);

        if (!input || value === undefined) return;

        input.value = value;

        input.dispatchEvent(
          new Event("input", { bubbles: true })
        );
      }
    );

    applyAllTrackSettings();
    updateTrackMuteSoloGains();
    updateTimeline();
    updateAudioInformation();
  }

  function undo() {
    if (state.undoStack.length <= 1) {
      toast("Undo history hin jiru.");
      return;
    }

    const current = state.undoStack.pop();

    state.redoStack.push(current);

    restoreSnapshot(
      state.undoStack[state.undoStack.length - 1]
    );

    toast("Undo");
  }

  function redo() {
    if (state.redoStack.length === 0) {
      toast("Redo history hin jiru.");
      return;
    }

    const snapshot = state.redoStack.pop();

    state.undoStack.push(snapshot);

    restoreSnapshot(snapshot);

    toast("Redo");
  }

  /* -------------------------------------------------------
     PROJECT SAVE / BACKUP / RESTORE
     ------------------------------------------------------- */

  function saveProject() {
    const project = {
      app: "Naol Music Studio 3D",
      version: 1,
      savedAt: new Date().toISOString(),
      projectName:
        $("projectName")?.value ||
        state.projectName,

      settings: getSnapshot(),

      tracks: Object.fromEntries(
        Object.entries(state.tracks).map(([type, track]) => [
          type,
          {
            name: track.name,
            volume: track.volume,
            panValue: track.panValue,
            muted: track.muted,
            solo: track.solo,
            trimStart: track.trimStart,
            trimEnd: track.trimEnd,
            duration: track.duration
          }
        ])
      )
    };

    try {
      localStorage.setItem(
        "naolMusicStudioProject",
        JSON.stringify(project)
      );

      setSaveStatus("Project saved");

      toast(
        "Project settings browser memory keessatti olkaa'aman."
      );

    } catch (error) {
      console.error(error);

      toast(
        "Project save hin milkoofne. Storage daangeffamuu danda'a."
      );
    }
  }

  function backupProject() {
    const project = {
      app: "Naol Music Studio 3D",
      version: 1,
      savedAt: new Date().toISOString(),
      projectName:
        $("projectName")?.value ||
        state.projectName,

      snapshot: getSnapshot(),

      note:
        "This backup stores project settings, not the original audio files."
    };

    const blob = new Blob(
      [JSON.stringify(project, null, 2)],
      { type: "application/json" }
    );

    downloadBlob(
      blob,
      "Naol_Music_Studio_Project.json"
    );

    toast(
      "Project backup buufame. Audio files addatti olkaa'i."
    );
  }

  async function restoreProjectFile(file) {
    if (!file) return;

    try {
      const textContent = await file.text();
      const project = JSON.parse(textContent);

      const snapshot =
        project.snapshot ||
        project.settings;

      if (!snapshot) {
        throw new Error("Project backup format sirrii miti.");
      }

      restoreSnapshot(
        JSON.stringify(snapshot)
      );

      if (project.projectName && $("projectName")) {
        $("projectName").value = project.projectName;
      }

      saveProject();

      toast(
        "Project settings restore godhame. Audio files addatti upload godhi."
      );

    } catch (error) {
      console.error(error);

      toast(
        "Project backup dubbisuu hin dandeenye."
      );
    }
  }

  /* -------------------------------------------------------
     SECTION NAVIGATION
     ------------------------------------------------------- */

  function showSection(sectionId) {
    const section = $(sectionId);

    if (!section) {
      toast("Section hin argamne: " + sectionId);
      return;
    }

    $$(".workspace-section").forEach((item) => {
      item.classList.remove("active-section");
    });

    section.classList.add("active-section");

    $$(".nav-item").forEach((item) => {
      item.classList.toggle(
        "active",
        item.dataset.section === sectionId
      );
    });

    if (sectionId === "editorSection") {
      requestAnimationFrame(() => {
        drawAllWaveforms();
        updateTimeline();
      });
    }

    if (sectionId === "keyboardSection") {
      renderVirtualKeyboard();
    }

    if (sectionId === "mixerSection") {
      updateMixerMeters();
    }

    if (sectionId === "exportSection") {
      updateExportSummary();
    }
  }

  function bindNavigation() {
    $$(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        const sectionId = button.dataset.section;

        if (sectionId) {
          showSection(sectionId);
        }
      });
    });
  }

  /* -------------------------------------------------------
     MIXER METERS / ANALYSIS
     ------------------------------------------------------- */

  function drawVisualizer() {
    const canvas = $("visualizer");

    if (!canvas || !state.masterAnalyser) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    const width = canvas.width =
      Math.max(300, canvas.clientWidth || 600);

    const height = canvas.height =
      Math.max(60, canvas.clientHeight || 115);

    const analyser = state.masterAnalyser;

    const data = new Uint8Array(
      analyser.frequencyBinCount
    );

    analyser.getByteFrequencyData(data);

    ctx.clearRect(0, 0, width, height);

    const bars = 64;
    const barWidth = width / bars;

    for (let i = 0; i < bars; i++) {
      const index = Math.floor(
        (i / bars) * data.length
      );

      const value = data[index] / 255;

      const barHeight = Math.max(
        2,
        value * height * 0.88
      );

      const hue = 245 + i * 1.1;

      ctx.fillStyle =
        `hsl(${hue}, 90%, ${55 + value * 20}%)`;

      ctx.fillRect(
        i * barWidth + 1,
        (height - barHeight) / 2,
        Math.max(1, barWidth - 2),
        barHeight
      );
    }
  }

  function drawAudioMeter() {
    const analyser = state.masterAnalyser;

    if (!analyser) return;

    const data = new Uint8Array(
      analyser.frequencyBinCount
    );

    analyser.getByteFrequencyData(data);

    let total = 0;

    for (let i = 0; i < data.length; i++) {
      total += data[i];
    }

    const average =
      data.length > 0
        ? total / data.length
        : 0;

    const percent = clamp(
      average / 255 * 100 * 2.5,
      0,
      100
    );

    const meter = $("masterMeter");

    if (meter) {
      meter.style.width = percent + "%";
    }

    const level = $("masterLevelText");

    if (level) {
      level.textContent =
        Math.round(percent) + "%";
    }
  }

  function updateMixerMeters() {
    const music = state.tracks.music;
    const voice = state.tracks.voice;
    const keyboard = state.tracks.keyboard;

    const anySolo = Object.values(state.tracks).some(
      (track) => track.solo
    );

    const getVolume = (track) => {
      if (track.muted) return 0;

      if (anySolo && !track.solo) return 0;

      return track.volume;
    };

    const musicPercent =
      clamp(getVolume(music) * 100, 0, 100);

    const voicePercent =
      clamp(getVolume(voice) * 100, 0, 100);

    const keyboardPercent =
      clamp(getVolume(keyboard) * 100, 0, 100);

    const meterIds = [
      ["masterMeter", state.masterVolume * 100],
      ["voiceMeter", voicePercent],
      ["keyboardMeter", keyboardPercent]
    ];

    meterIds.forEach(([id, percent]) => {
      const element = $(id);

      if (element) {
        element.style.width = percent + "%";
      }
    });

    const clipping = $("clippingStatus");

    if (clipping) {
      clipping.textContent =
        musicPercent > 95 ||
        voicePercent > 95 ||
        keyboardPercent > 95
          ? "High level"
          : "No clipping detected";

      clipping.classList.toggle(
        "text-warning",
        musicPercent > 95 ||
        voicePercent > 95 ||
        keyboardPercent > 95
      );
    }
  }

  async function analyzeAudio() {
    const track = getSelectedTrack();

    if (!hasAudio(track)) {
      toast("Analysis gochuuf audio upload godhi.");
      return;
    }

    const buffer = track.audio.buffer;

    let peak = 0;
    let sumSquares = 0;
    let sampleCount = 0;

    const channelCount = buffer.numberOfChannels;

    for (let channel = 0; channel < channelCount; channel++) {
      const data = buffer.getChannelData(channel);

      for (let i = 0; i < data.length; i++) {
        const sample = data[i];

        peak = Math.max(peak, Math.abs(sample));

        sumSquares += sample * sample;
        sampleCount++;
      }
    }

    const rms =
      sampleCount > 0
        ? Math.sqrt(sumSquares / sampleCount)
        : 0;

    setStatus(
      "analysisDuration",
      formatTime(buffer.duration)
    );

    setStatus(
      "analysisPeak",
      peak.toFixed(4)
    );

    setStatus(
      "analysisRms",
      rms.toFixed(4)
    );

    setStatus(
      "analysisSampleRate",
      buffer.sampleRate + " Hz"
    );

    setStatus(
      "analysisStatus",
      "Analysis complete"
    );

    toast("Audio analysis xumurame.");
  }

  /* -------------------------------------------------------
     EXPORT SUMMARY
     ------------------------------------------------------- */

  function updateExportSummary() {
    setStatus(
      "exportDuration",
      formatTime(getProjectDuration())
    );

    setStatus(
      "exportFormatSummary",
      $("exportFormat")?.value?.toUpperCase() || "WAV"
    );

    setStatus(
      "exportSampleRateSummary",
      $("exportSampleRate")?.value + " Hz"
    );

    setStatus(
      "exportQualitySummary",
      $("exportQuality")?.value || "high"
    );
  }

  /* -------------------------------------------------------
     FILE UPLOAD / DROP ZONE
     ------------------------------------------------------- */

  function bindFileUpload() {
    const input = $("audioUpload");

    if (input) {
      input.addEventListener("change", async () => {
        const files = Array.from(input.files || []);

        if (files.length === 0) return;

        const target = state.selectedTrack;

        await importAudioFile(files[0], target);

        input.value = "";
      });
    }

    const zone = $("uploadDropZone");

    if (zone) {
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();

        zone.classList.add("drag-over");
      });

      zone.addEventListener("dragleave", () => {
        zone.classList.remove("drag-over");
      });

      zone.addEventListener("drop", async (event) => {
        event.preventDefault();

        zone.classList.remove("drag-over");

        const files = Array.from(
          event.dataTransfer?.files || []
        );

        const file = files.find(
          (item) =>
            item.type.startsWith("audio/") ||
            /\.(wav|mp3|m4a|aac|ogg|opus|flac|webm)$/i.test(
              item.name
            )
        );

        if (!file) {
          toast("Audio file drop godhi.");
          return;
        }

        await importAudioFile(
          file,
          state.selectedTrack
        );
      });
    }
  }

  /* -------------------------------------------------------
     TRACK SELECTION
     ------------------------------------------------------- */

  function bindTrackSelection() {
    $$(".timeline-track").forEach((element) => {
      const type = element.dataset.trackType;

      if (!type || !state.tracks[type]) return;

      element.addEventListener("click", (event) => {
        if (
          event.target.closest("button") ||
          event.target.closest(".audio-clip")
        ) {
          return;
        }

        selectTrack(type);
      });
    });

    $$("[data-track-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();

        toggleTrackAction(
          button.dataset.track,
          button.dataset.trackAction
        );
      });
    });
  }

  /* -------------------------------------------------------
     TIMELINE SEEK
     ------------------------------------------------------- */

  function bindTimelineSeeking() {
    const ruler = $("timelineRuler");

    if (!ruler) return;

    ruler.style.cursor = "pointer";

    ruler.addEventListener("click", (event) => {
      const rect = ruler.getBoundingClientRect();

      const ratio = clamp(
        (event.clientX - rect.left) /
          Math.max(1, rect.width),
        0,
        1
      );

      const duration = getProjectDuration();

      seekPlayback(ratio * duration);
    });
  }

  /* -------------------------------------------------------
     PROJECT NAME / RESTORE INPUT
     ------------------------------------------------------- */

  function bindProjectTools() {
    const nameInput = $("projectName");

    if (nameInput) {
      nameInput.addEventListener("input", () => {
        state.projectName = nameInput.value;
      });
    }

    const restoreInput = $("restoreProjectInput");

    if (restoreInput) {
      restoreInput.addEventListener("change", async () => {
        const file = restoreInput.files?.[0];

        if (file) {
          await restoreProjectFile(file);
        }

        restoreInput.value = "";
      });
    }
  }

  /* -------------------------------------------------------
     BUTTON BINDINGS
     ------------------------------------------------------- */

  function bindButton(id, callback) {
    const element = $(id);

    if (!element) {
      console.warn(
        "Naol Music Studio: missing element #" + id
      );

      return;
    }

    element.addEventListener("click", (event) => {
      event.preventDefault();

      try {
        const result = callback(event);

        if (result && typeof result.catch === "function") {
          result.catch((error) => {
            console.error(error);

            toast(
              "Hojii kana raawwachuun hin milkoofne."
            );
          });
        }
      } catch (error) {
        console.error(error);

        toast(
          "Dogoggorri uumame. Console qoradhu."
        );
      }
    });
  }

  function bindButtons() {
    bindButton("playBtn", togglePlayback);

    bindButton("stopBtn", () => stopPlayback());

    bindButton("restartBtn", () => {
      state.playStartOffset = 0;

      if (state.isPlaying) {
        startPlayback();
      } else {
        setStatus("timeDisplay", "00:00");
        updatePlayhead(0);
      }
    });

    bindButton("splitBtn", splitSelectedTrack);
    bindButton("trimStartBtn", trimTrackStart);
    bindButton("trimEndBtn", trimTrackEnd);
    bindButton("deleteAudioBtn", deleteSelectedAudio);

    bindButton("zoomInBtn", () => {
      state.zoom = clamp(state.zoom * 1.2, 0.5, 5);

      updateTimeline();
    });

    bindButton("zoomOutBtn", () => {
      state.zoom = clamp(state.zoom / 1.2, 0.5, 5);

      updateTimeline();
    });

    bindButton("fitTimelineBtn", () => {
      state.zoom = 1;

      updateTimeline();
    });

    bindButton("resetAdjustmentsBtn", resetAdjustments);
    bindButton("compareBtn", toggleCompare);

    bindButton("recordBtn", startVoiceRecording);
    bindButton("pauseRecordBtn", pauseVoiceRecording);
    bindButton("resumeRecordBtn", resumeVoiceRecording);
    bindButton("stopRecordBtn", stopVoiceRecording);

    bindButton("downloadRecordingBtn", downloadVoiceRecording);
    bindButton("useRecordingBtn", addVoiceRecordingToTimeline);
    bindButton("discardRecordingBtn", discardVoiceRecording);

    bindButton("recordKeyboardBtn", startKeyboardRecording);
    bindButton("pauseKeyboardBtn", pauseKeyboardRecording);
    bindButton("resumeKeyboardBtn", resumeKeyboardRecording);
    bindButton("stopKeyboardBtn", stopKeyboardRecording);

    bindButton("playKeyboardRecordingBtn", playKeyboardRecording);
    bindButton("useKeyboardRecordingBtn", addKeyboardRecordingToTimeline);
    bindButton("downloadKeyboardRecordingBtn", downloadKeyboardRecording);

    bindButton("sustainBtn", () => {
      const button = $("sustainBtn");

      if (!button) return;

      button.classList.toggle("active");

      button.setAttribute(
        "aria-pressed",
        button.classList.contains("active")
          ? "true"
          : "false"
      );

      toast(
        button.classList.contains("active")
          ? "Sustain enabled"
          : "Sustain disabled"
      );
    });

    bindButton("muteBtn", () => {
      state.tracks.music.muted =
        !state.tracks.music.muted;

      updateTrackMuteSoloGains();
    });

    bindButton("analyzeAudioBtn", analyzeAudio);

    bindButton("exportBtn", exportAudio);
    bindButton("downloadExportBtn", downloadExport);

    bindButton("saveProjectBtn", saveProject);
    bindButton("backupProjectBtn", backupProject);

    bindButton("undoBtn", undo);
    bindButton("redoBtn", redo);

    bindButton("addTrackBtn", addEmptyTrack);

    $$(".preset-button").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.preset;

        if (name) {
          applyPreset(name);
        }
      });
    });
  }

  /* -------------------------------------------------------
     PLAYBACK SPEED
     ------------------------------------------------------- */

  function bindPlaybackSpeed() {
    const select = $("playbackSpeed");

    if (!select) return;

    select.addEventListener("change", () => {
      const speed = Number(select.value);

      state.playbackSpeed = clamp(
        Number.isFinite(speed) ? speed : 1,
        0.25,
        2
      );

      if (state.isPlaying) {
        const current = getPlaybackTime();

        state.playStartOffset = current;

        startPlayback();
      }
    });
  }

  /* -------------------------------------------------------
     SEEK BAR
     ------------------------------------------------------- */

  function bindSeekBar() {
    const seekBar = $("seekBar");

    if (!seekBar) return;

    seekBar.addEventListener("input", () => {
      seekPlayback(seekBar.value);
    });
  }

  /* -------------------------------------------------------
     EXPORT SETTINGS
     ------------------------------------------------------- */

  function bindExportSettings() {
    [
      "exportFormat",
      "exportSampleRate",
      "exportQuality",
      "exportChannels",
      "exportSource",
      "normalizeExport"
    ].forEach((id) => {
      const element = $(id);

      if (!element) return;

      element.addEventListener("change", () => {
        updateExportSummary();
      });
    });
  }

  /* -------------------------------------------------------
     VISIBILITY / RESIZE
     ------------------------------------------------------- */

  function bindResize() {
    let resizeTimer;

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        drawAllWaveforms();
        updateTimeline();
      }, 120);
    });
  }

  /* -------------------------------------------------------
     INIT
     ------------------------------------------------------- */

  function initialize() {
    if (state.initialized) return;

    state.initialized = true;

    bindNavigation();
    bindFileUpload();
    bindTrackSelection();
    bindTimelineSeeking();
    bindProjectTools();

    bindEffectControls();
    bindButtons();
    bindPlaybackSpeed();
    bindSeekBar();
    bindExportSettings();
    bindResize();

    renderVirtualKeyboard();
    bindComputerKeyboard();

    updateAudioInformation();
    updateTimeline();
    updatePlaybackButtons();

    updateTrackMuteSoloGains();
    updateRecordingButtons();
    updateKeyboardRecordingButtons();
    updateExportSummary();

    saveUndoState();

    setEngineStatus("Ready");

    setStatus(
      "audioStatus",
      "Upload audio to begin"
    );

    setStatus(
      "recordingState",
      "Ready to record"
    );

    setStatus(
      "keyboardStatus",
      "Keyboard ready"
    );

    setStatus(
      "exportStatus",
      "Ready to export"
    );

    setSaveStatus("Ready");

    console.log(
      "Naol Music Studio 3D initialized successfully."
    );
  }

  /* -------------------------------------------------------
     STARTUP
     ------------------------------------------------------- */

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }

})();
