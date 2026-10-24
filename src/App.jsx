import React, { useEffect, useState, useCallback, useRef, Component } from 'react';
import { useCamera } from './hooks/useCamera';
import { useTensorflow, formatObstacleWarning } from './hooks/useTensorflow';
import { useSpeech, isHindiText } from './hooks/useSpeech';
import { useGemini } from './hooks/useGemini';

/**
 * Error Boundary
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('AURA AI UI Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#181613',
          color: '#ede8df',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: 'sans-serif'
        }}>
          <h1 style={{ color: '#e05d4f', fontSize: '24px', marginBottom: '12px' }}>AURA AI Recovery</h1>
          <p style={{ maxWidth: '400px', marginBottom: '20px', lineHeight: '1.5', color: '#c8a66b' }}>
            A temporary issue occurred. Tap below to reload the vision assistant.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#c8a66b',
              color: '#181613',
              border: 'none',
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: 'bold',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Reload AURA AI
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const [hasActivated, setHasActivated] = useState(false);
  const [statusText, setStatusText] = useState('Tap anywhere to speak or say "Hey Aura"');

  // Callback ref bridge
  const onCommandRef = useRef(null);
  const onWakeRef = useRef(null);
  const onBargeInRef = useRef(null);
  const onToggleMuteRef = useRef(null);
  const onStopDetectionRef = useRef(null);
  const onStartDetectionRef = useRef(null);
  const isBusyRef = useRef(false);
  const isUserSpeakingRef = useRef(false);

  const handleSpeechActive = useCallback((active) => {
    isUserSpeakingRef.current = active;
  }, []);

  // 1. Camera Hook
  const {
    videoRef,
    isCameraActive,
    cameraError,
    startCamera,
    captureSnapshot,
  } = useCamera();

  // 2. Gemini Cloud Hook (Engine B: On-Demand Scene, Currency & Q&A)
  const {
    analyzeFrame,
    abortAnalysis,
  } = useGemini();

  // 3. Speech Hook (Single Unified High-Fidelity Voice + Enhanced Voice Recognition)
  const {
    isSpeaking,
    isListening,
    micNotice,
    activeLang,
    speak,
    stopSpeaking,
    toggleLanguage,
    unlockMic,
    triggerListenNow,
  } = useSpeech({
    onCommand: (cmd) => onCommandRef.current?.(cmd),
    onWake: () => onWakeRef.current?.(),
    onBargeIn: () => onBargeInRef.current?.(),
    onToggleMute: (action) => onToggleMuteRef.current?.(action),
    onStopDetection: () => onStopDetectionRef.current?.(),
    onStartDetection: () => onStartDetectionRef.current?.(),
    onSpeechActive: handleSpeechActive,
  });

  // 4. Real-time Spoken Obstacle Alert Handler (Only active when alerts are enabled)
  const handleObstacleAlert = useCallback(
    (obstacle) => {
      if (isBusyRef.current || isSpeaking) return false;
      const isHindi = activeLang && activeLang.startsWith('hi');
      const warningText = formatObstacleWarning(obstacle, isHindi);
      if (warningText) {
        speak(warningText, { isUrgent: obstacle.distanceLabel === 'urgent' });
        return true;
      }
      return false;
    },
    [activeLang, isSpeaking, speak]
  );

  // 5. TensorFlow COCO-SSD Hook (Alerts OFF by default; starts only when user says "Alert On")
  const {
    isMuted,
    toggleMute,
    isDetectionActive,
    detectedCount,
    startDetection,
    stopDetection,
    setIsPaused: setTensorflowPaused,
    playTone,
    triggerHaptic,
    unlockAudio,
  } = useTensorflow(videoRef, isCameraActive, {
    onObstacleAlert: handleObstacleAlert,
    isSpeaking,
    isUserSpeaking: isUserSpeakingRef,
  });

  /* ================================================================
     WAKE WORD BARGE-IN INTERRUPTION HANDLER
     ================================================================ */
  const handleBargeIn = useCallback(() => {
    console.log('[AURA AI] Barge-in triggered. Aborting current operations.');
    stopSpeaking();
    abortAnalysis();
    isBusyRef.current = false;
    if (isDetectionActive) {
      setTensorflowPaused(false);
    }
    playTone(900, 0.05);
    setStatusText('Listening to you… Speak now');
  }, [stopSpeaking, abortAnalysis, isDetectionActive, setTensorflowPaused, playTone]);

  /* ================================================================
     ON-DEMAND VISION SCANNER (Currency, Ahead, Text & User Q&A)
     Single consistent AI voice output — no clashing voices
     ================================================================ */
  const runVisionAnalysis = useCallback(
    async (mode = 'describe', queryText = '') => {
      if (isBusyRef.current) return;
      isBusyRef.current = true;

      // Temporarily pause obstacle radar
      setTensorflowPaused(true);
      playTone(mode === 'currency' ? 750 : 580, 0.08);
      triggerHaptic([60]);

      const isHindi = isHindiText(queryText) || (activeLang && activeLang.startsWith('hi'));
      const statusAction =
        mode === 'currency'
          ? isHindi ? 'नोट की जाँच हो रही है…' : 'Checking currency note…'
          : mode === 'question'
          ? isHindi ? 'आपके सवाल का जवाब खोजा जा रहा है…' : 'Checking what you asked…'
          : isHindi ? 'सामने का दृश्य देखा जा रहा है…' : 'Analyzing what is ahead…';

      setStatusText(statusAction);

      try {
        // Step 1: Capture offscreen compressed 640x480 frame (<50KB)
        const snapshot = await captureSnapshot();

        // Step 2: Query Gemini Cloud Engine
        const answer = await analyzeFrame(snapshot, {
          mode: mode === 'question' ? 'describe' : mode,
          question: queryText,
          language: isHindi ? 'hi-IN' : 'en-US',
        });

        if (answer) {
          setStatusText(isHindi ? 'बोल रहा हूँ…' : 'Speaking…');
          playTone(880, 0.06);

          // Step 3: Speak description aloud via Single Unified AI Voice
          speak(answer, {
            onFinish: () => {
              isBusyRef.current = false;
              if (isDetectionActive) setTensorflowPaused(false);
              setStatusText('Listening hands-free. Say "Hey Aura" anytime.');
            },
          });
        } else {
          isBusyRef.current = false;
          if (isDetectionActive) setTensorflowPaused(false);
          setStatusText('Listening hands-free. Say "Hey Aura" anytime.');
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log('[AURA AI] Vision analysis aborted by user barge-in.');
          return;
        }
        console.error('Vision analysis error:', err);
        const errMsg = isHindi
          ? 'विश्लेषण नहीं हो सका। कृपया दोबारा पूछें।'
          : 'Could not complete analysis. Please ask again.';
        setStatusText(errMsg);
        speak(errMsg, {
          onFinish: () => {
            isBusyRef.current = false;
            if (isDetectionActive) setTensorflowPaused(false);
            setStatusText('Listening hands-free. Say "Hey Aura" anytime.');
          },
        });
      }
    },
    [captureSnapshot, analyzeFrame, setTensorflowPaused, playTone, triggerHaptic, activeLang, speak, isDetectionActive]
  );

  /* ================================================================
     VOICE COMMAND DISPATCHER & STATE MACHINE
     Handles: currency, ahead, stop_detection, start_detection, & user questions
     ================================================================ */
  const handleVoiceCommand = useCallback(
    (cmd) => {
      unlockAudio();
      if (cmd.type === 'currency') {
        runVisionAnalysis('currency', cmd.query || cmd.raw);
      } else if (cmd.type === 'describe') {
        runVisionAnalysis('describe', cmd.query || cmd.raw);
      } else if (cmd.type === 'read') {
        runVisionAnalysis('read', cmd.query || cmd.raw);
      } else if (cmd.type === 'question') {
        // Conversational Q&A: listens to user and replies according to what they ask
        runVisionAnalysis('question', cmd.query || cmd.raw);
      }
    },
    [runVisionAnalysis, unlockAudio]
  );

  const handleWakeWord = useCallback(() => {
    unlockAudio();
    playTone(880, 0.08);
    setTimeout(() => playTone(1174, 0.12), 70);
    triggerHaptic([70, 40, 70]);

    const isHindi = activeLang && activeLang.startsWith('hi');
    speak(isHindi ? 'हाँ, बताइए।' : 'I am listening, what is your question?', {
      onFinish: () => {
        setStatusText(isHindi ? 'सुन रहा हूँ… बोलिए' : 'Listening to you… Speak now');
        triggerListenNow();
      },
    });
  }, [playTone, triggerHaptic, unlockAudio, activeLang, speak, triggerListenNow]);

  const handleVoiceToggleMute = useCallback(
    (action) => {
      if (action === 'mute' && !isMuted) {
        toggleMute();
        speak(activeLang && activeLang.startsWith('hi') ? 'बीप बंद।' : 'Obstacle beeps muted.');
      } else if (action === 'unmute' && isMuted) {
        toggleMute();
        speak(activeLang && activeLang.startsWith('hi') ? 'बीप चालू।' : 'Obstacle beeps unmuted.');
      }
    },
    [isMuted, toggleMute, activeLang, speak]
  );

  // User says "alert on" -> start camera detection alert
  const handleStartDetection = useCallback(() => {
    unlockAudio();
    stopSpeaking();
    startDetection();
    const isHindi = activeLang && activeLang.startsWith('hi');
    const msg = isHindi ? 'अलर्ट चालू।' : 'Alerts on.';
    setStatusText('Obstacle radar active — beeping continuously');
    speak(msg);
  }, [startDetection, stopSpeaking, activeLang, speak, unlockAudio]);

  // User says "stop detection", "alert off", or "stop" -> stop camera detection alert completely
  const handleStopDetection = useCallback(() => {
    unlockAudio();
    stopSpeaking();
    abortAnalysis();
    isBusyRef.current = false;
    stopDetection();

    const isHindi = activeLang && activeLang.startsWith('hi');
    const msg = isHindi ? 'डिटेक्शन बंद।' : 'Detection stopped.';
    setStatusText(msg);
    speak(msg, {
      onFinish: () => {
        setStatusText('Listening hands-free. Say "Hey Aura" anytime.');
      },
    });
  }, [stopDetection, stopSpeaking, abortAnalysis, activeLang, speak, unlockAudio]);

  // Connect stable callback refs
  useEffect(() => {
    onCommandRef.current = handleVoiceCommand;
    onWakeRef.current = handleWakeWord;
    onBargeInRef.current = handleBargeIn;
    onToggleMuteRef.current = handleVoiceToggleMute;
    onStopDetectionRef.current = handleStopDetection;
    onStartDetectionRef.current = handleStartDetection;
  }, [
    handleVoiceCommand,
    handleWakeWord,
    handleBargeIn,
    handleVoiceToggleMute,
    handleStopDetection,
    handleStartDetection,
  ]);

  /* Keyboard Navigation fallback */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      unlockAudio();

      if (e.code === 'Space') {
        e.preventDefault();
        // Spacebar triggers listen mode to speak to Aura
        triggerListenNow();
        setStatusText('Listening to you… Speak now');
        playTone(880, 0.08);
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        runVisionAnalysis('currency');
      } else if (e.code === 'KeyA') {
        e.preventDefault();
        runVisionAnalysis('describe');
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'KeyS' || e.code === 'Escape') {
        e.preventDefault();
        stopSpeaking();
        abortAnalysis();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runVisionAnalysis, toggleMute, stopSpeaking, abortAnalysis, unlockAudio, triggerListenNow, playTone]);

  /* Camera Initialization */
  useEffect(() => {
    async function init() {
      await startCamera();
    }
    init();
  }, [startCamera]);

  /* Direct "Listen to User" Tap Handler */
  const handleListenAction = useCallback(
    async (e) => {
      if (e?.target?.closest('header')) return;
      unlockAudio();
      await unlockMic();
      playTone(880, 0.1);

      if (!hasActivated) {
        setHasActivated(true);
        setStatusText('Listening to you… Speak now');
        const isHindi = activeLang && activeLang.startsWith('hi');
        speak(
          isHindi
            ? 'ऑरा सक्रिय है। पूछिए क्या देखना है, या बोलें नोट चेक करो।'
            : 'Aura is listening. Ask what is ahead, check money, or turn alert on.'
        );
        triggerListenNow();
      } else {
        setStatusText('Listening to you… Speak now');
        triggerListenNow();
      }
    },
    [unlockAudio, unlockMic, hasActivated, activeLang, speak, playTone, triggerListenNow]
  );

  return (
    <div className="aura-shell" onClick={handleListenAction}>
      {/* Minimal Header */}
      <header className="aura-header">
        <div className="brand-group">
          <span className="brand-title">AURA AI</span>
          {/* Alert On/Off Toggle Button */}
          <button
            type="button"
            className={`status-pill ${isDetectionActive ? 'pill-active' : 'pill-inactive'}`}
            onClick={(e) => {
              e.stopPropagation();
              unlockAudio();
              if (isDetectionActive) {
                handleStopDetection();
              } else {
                handleStartDetection();
              }
            }}
            title="Click or say 'Alert On' / 'Stop Detection'"
          >
            <span className={`status-dot ${isDetectionActive ? 'listening' : ''}`} />
            <span>{isDetectionActive ? 'ALERTS: ON' : 'ALERTS: OFF'}</span>
          </button>
        </div>

        <div className="header-actions">
          {/* Mute Proximity Beeps */}
          <button
            type="button"
            className={`control-btn ${isMuted ? 'btn-muted' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              unlockAudio();
              toggleMute();
            }}
            aria-label={isMuted ? 'Beeps muted' : 'Beeps active'}
          >
            {isMuted ? 'MUTED (M)' : 'BEEPS (M)'}
          </button>

          {/* Language Switch */}
          <button
            type="button"
            className="lang-badge"
            onClick={(e) => {
              e.stopPropagation();
              unlockAudio();
              toggleLanguage();
            }}
            aria-label="Toggle language"
          >
            {activeLang && activeLang.startsWith('hi') ? 'हिन्दी' : 'English'}
          </button>
        </div>
      </header>

      {/* Main Viewport: Clean Camera View + Acoustic Listen Hub */}
      <main className="aura-main">
        <div className="camera-clean-card" aria-hidden="true">
          <video
            ref={videoRef}
            className="camera-clean-video"
            playsInline
            muted
            autoPlay
          />
        </div>

        {/* Central Voice & Acoustic Hub — Tap to Speak to Aura */}
        <div className="acoustic-hub" role="status" aria-live="polite">
          <div className={`acoustic-pulse-ring ${isSpeaking ? 'speaking' : isListening ? 'listening' : ''}`}>
            <div className="acoustic-core" />
          </div>
          <h1 className="aura-status-line">
            {!hasActivated ? 'Tap anywhere to start Aura' : statusText}
          </h1>
          <p className="aura-sub-caption">
            {!hasActivated
              ? 'Tap screen once to enable voice assistant'
              : isDetectionActive
              ? `Radar active (${detectedCount} obstacle${detectedCount === 1 ? '' : 's'} in view) • Say "Stop detection" to pause`
              : 'Say "Alert on" to start camera detection • "Check money" • "What\'s ahead"'}
          </p>
        </div>

        {/* Error notices */}
        {cameraError && <div className="notice-banner" role="alert">{cameraError}</div>}
        {micNotice && <div className="notice-banner" role="alert">{micNotice}</div>}
      </main>

      {/* Footer */}
      <footer className="aura-footer">
        <span className="footer-voice-hint">
          {!hasActivated ? '👉 Tap anywhere to activate audio' : '🎤 Tap circle or say "Hey Aura" to speak'}
        </span>
        <div className="footer-links">
          <a href="#terms">Terms</a>
          <span className="divider">•</span>
          <a href="#privacy">Privacy</a>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
