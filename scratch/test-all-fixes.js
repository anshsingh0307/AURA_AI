import { classifyVoiceIntent } from '../src/hooks/useSpeech.js';
import { calculateProximityLevel, PROXIMITY_CONFIG } from '../src/hooks/useTensorflow.js';
import { parseCurrencyResult } from '../server.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

console.log('====================================================');
console.log('AURA AI: Comprehensive QA Integration & Logic Suite');
console.log('====================================================\n');

/* ------------------------------------------------------------------
   TEST SUITE 1: VOICE COMMAND MATCHING & NORMALIZATION
   ------------------------------------------------------------------ */
console.log('--- TEST SUITE 1: Voice Command Matching & Normalization ---');

const voiceTests = [
  // 1. Stop Detection & Alert Off
  { input: 'stop detection', expected: 'stop_detection' },
  { input: 'stop the detection', expected: 'stop_detection' },
  { input: 'stop detecting', expected: 'stop_detection' },
  { input: 'alert off', expected: 'stop_detection' },
  { input: 'alerts off', expected: 'stop_detection' },
  { input: 'alert mode off', expected: 'stop_detection' },
  { input: 'turn off detection', expected: 'stop_detection' },
  { input: 'cancel detection', expected: 'stop_detection' },
  { input: 'stop', expected: 'stop' },
  { input: 'cancel', expected: 'stop' },
  { input: 'Hey Aura stop detection', expected: 'stop_detection' },
  { input: 'Hey Aura alert off', expected: 'stop_detection' },
  { input: 'अलर्ट बंद', expected: 'stop_detection' },
  { input: 'डिटेक्शन बंद', expected: 'stop_detection' },

  // 2. Alert On & Start Detection
  { input: 'alert on', expected: 'start_detection' },
  { input: 'alerts on', expected: 'start_detection' },
  { input: 'alert mode on', expected: 'start_detection' },
  { input: 'turn on alerts', expected: 'start_detection' },
  { input: 'start detection', expected: 'start_detection' },
  { input: 'Hey Aura alert on', expected: 'start_detection' },
  { input: 'अलर्ट चालू', expected: 'start_detection' },
  { input: 'डिटेक्शन चालू', expected: 'start_detection' },

  // 3. Check Money & Currency
  { input: 'check money', expected: 'currency' },
  { input: 'money', expected: 'currency' },
  { input: 'check note', expected: 'currency' },
  { input: 'how much money', expected: 'currency' },
  { input: 'Hey Aura check money', expected: 'currency' },
  { input: 'नोट चेक करो', expected: 'currency' },
  { input: 'कितने का नोट है', expected: 'currency' },

  // 4. Other Standard Commands
  { input: "what's ahead", expected: 'describe' },
  { input: 'ahead', expected: 'describe' },
  { input: 'read text', expected: 'read' },
  { input: 'mute', expected: 'mute' },
  { input: 'unmute', expected: 'unmute' },
  { input: 'what color is my shirt', expected: 'question' },
];

for (const vt of voiceTests) {
  const res = classifyVoiceIntent(vt.input);
  assert(res && res.type === vt.expected, `Voice Command: "${vt.input}" -> ${vt.expected}`);
}

/* ------------------------------------------------------------------
   TEST SUITE 2: DISTANCE-BASED PROXIMITY LEVELS & AUDIO TIMING
   ------------------------------------------------------------------ */
console.log('\n--- TEST SUITE 2: Proximity Level Calculation & Audio Mapping ---');

// Level Configuration Verification
assert(PROXIMITY_CONFIG.LEVELS.near.intervalMs === 120, 'Near proximity interval is 120ms (rapid alarm)');
assert(PROXIMITY_CONFIG.LEVELS.near.frequency === 1050, 'Near proximity frequency is 1050Hz (high pitch)');
assert(Array.isArray(PROXIMITY_CONFIG.LEVELS.near.haptic), 'Near proximity triggers haptic feedback');

assert(PROXIMITY_CONFIG.LEVELS.medium.intervalMs === 380, 'Medium proximity interval is 380ms');
assert(PROXIMITY_CONFIG.LEVELS.medium.frequency === 680, 'Medium proximity frequency is 680Hz');

assert(PROXIMITY_CONFIG.LEVELS.far.intervalMs === 850, 'Far proximity interval is 850ms (slow tempo)');
assert(PROXIMITY_CONFIG.LEVELS.far.frequency === 440, 'Far proximity frequency is 440Hz');

// Geometric Measurement -> Proximity Level Mapping
// 1. Person
assert(calculateProximityLevel({ isPerson: true, heightRatio: 0.45, areaRatio: 0.08 }) === 'near', 'Close person -> near');
assert(calculateProximityLevel({ isPerson: true, heightRatio: 0.22, areaRatio: 0.02 }) === 'medium', 'Mid-distance person -> medium');
assert(calculateProximityLevel({ isPerson: true, heightRatio: 0.10, areaRatio: 0.005 }) === 'far', 'Far person -> far');
assert(calculateProximityLevel({ isPerson: true, heightRatio: 0.03, areaRatio: 0.0008 }) === null, 'Very distant person (<0.06h) -> null (silent, no fake distance)');

// 2. Vehicle
assert(calculateProximityLevel({ isVehicle: true, widthRatio: 0.40, areaRatio: 0.10 }) === 'near', 'Close vehicle -> near');
assert(calculateProximityLevel({ isVehicle: true, widthRatio: 0.20, areaRatio: 0.03 }) === 'medium', 'Mid-distance vehicle -> medium');
assert(calculateProximityLevel({ isVehicle: true, widthRatio: 0.09, areaRatio: 0.005 }) === 'far', 'Far vehicle -> far');
assert(calculateProximityLevel({ isVehicle: true, widthRatio: 0.03, areaRatio: 0.0005 }) === null, 'Very distant vehicle -> null (silent)');

// 3. Everyday Obstacle (chair, table, book, door)
assert(calculateProximityLevel({ isPerson: false, isVehicle: false, widthRatio: 0.45, heightRatio: 0.40, areaRatio: 0.15 }) === 'near', 'Close obstacle -> near');
assert(calculateProximityLevel({ isPerson: false, isVehicle: false, widthRatio: 0.20, heightRatio: 0.18, areaRatio: 0.025 }) === 'medium', 'Mid-distance obstacle -> medium');
assert(calculateProximityLevel({ isPerson: false, isVehicle: false, widthRatio: 0.08, heightRatio: 0.08, areaRatio: 0.005 }) === 'far', 'Far obstacle -> far');
assert(calculateProximityLevel({ isPerson: false, isVehicle: false, widthRatio: 0.03, heightRatio: 0.03, areaRatio: 0.0005 }) === null, 'Distant background item -> null (silent)');

// 4. Null / No Threat in view
assert(calculateProximityLevel(null) === null, 'Empty frame / 0 detections -> null (strictly silent)');

/* ------------------------------------------------------------------
   TEST SUITE 3: INDIAN BANKNOTE CURRENCY PARSING & VALIDATION
   ------------------------------------------------------------------ */
console.log('\n--- TEST SUITE 3: Indian Currency Recognition (₹10, ₹50, ₹100, ₹500) ---');

// 1. ₹10 Note
const tenRes = parseCurrencyResult('I see a ten rupee note with chocolate brown color.', false);
assert(tenRes.recognized === true && tenRes.denomination === 10, 'Identify ₹10 note in English');
assert(tenRes.text === 'The detected note appears to be ten rupees.', 'Correct English speech text for ₹10');

const tenHindi = parseCurrencyResult('यहाँ दस रुपये का नोट दिख रहा है।', true);
assert(tenHindi.recognized === true && tenHindi.denomination === 10, 'Identify ₹10 note in Hindi');
assert(tenHindi.text === 'पहचाना गया नोट दस रुपये का प्रतीत होता है।', 'Correct Hindi speech text for ₹10');

// 2. ₹50 Note
const fiftyRes = parseCurrencyResult('The banknote is fifty rupees fluorescent blue.', false);
assert(fiftyRes.recognized === true && fiftyRes.denomination === 50, 'Identify ₹50 note in English');
assert(fiftyRes.text === 'The detected note appears to be fifty rupees.', 'Correct English speech text for ₹50');

const fiftyHindi = parseCurrencyResult('यह पचास रुपये का नोट है।', true);
assert(fiftyHindi.recognized === true && fiftyHindi.denomination === 50, 'Identify ₹50 note in Hindi');
assert(fiftyHindi.text === 'पहचाना गया नोट पचास रुपये का प्रतीत होता है।', 'Correct Hindi speech text for ₹50');

// 3. ₹100 Note
const hundredRes = parseCurrencyResult('A one hundred rupee lavender note is visible.', false);
assert(hundredRes.recognized === true && hundredRes.denomination === 100, 'Identify ₹100 note in English');
assert(hundredRes.text === 'The detected note appears to be one hundred rupees.', 'Correct English speech text for ₹100');

const hundredHindi = parseCurrencyResult('एक सौ रुपये का नोट दिख रहा है।', true);
assert(hundredHindi.recognized === true && hundredHindi.denomination === 100, 'Identify ₹100 note in Hindi');
assert(hundredHindi.text === 'पहचाना गया नोट एक सौ रुपये का प्रतीत होता है।', 'Correct Hindi speech text for ₹100');

// 4. ₹500 Note
const fiveHundredRes = parseCurrencyResult('The detected note appears to be 500 rupees.', false);
assert(fiveHundredRes.recognized === true && fiveHundredRes.denomination === 500, 'Identify ₹500 note in English');
assert(fiveHundredRes.text === 'The detected note appears to be five hundred rupees.', 'Correct English speech text for ₹500');

const fiveHundredHindi = parseCurrencyResult('सामने पाँच सौ का नोट है।', true);
assert(fiveHundredHindi.recognized === true && fiveHundredHindi.denomination === 500, 'Identify ₹500 note in Hindi');
assert(fiveHundredHindi.text === 'पहचाना गया नोट पाँच सौ रुपये का प्रतीत होता है।', 'Correct Hindi speech text for ₹500');

// 5. Unclear / Blurry / Ambiguous Image Handling (Never fabricate a denomination!)
const unclearRes = parseCurrencyResult('Unable to identify the note confidently. Please reposition the note and try again.', false);
assert(unclearRes.recognized === false && unclearRes.denomination === null, 'Unclear note reports recognized=false');
assert(unclearRes.text === 'Unable to identify the note confidently. Please reposition the note and try again.', 'Unclear note announces guidance');

const unclearHindi = parseCurrencyResult('नोट की स्पष्ट पहचान नहीं हो सकी। कृपया नोट को सीधा करके दोबारा प्रयास करें।', true);
assert(unclearHindi.recognized === false && unclearHindi.denomination === null, 'Unclear note in Hindi reports recognized=false');
assert(unclearHindi.text === 'नोट की स्पष्ट पहचान नहीं हो सकी। कृपया नोट को सीधा करके दोबारा प्रयास करें।', 'Unclear note in Hindi announces guidance');

// 6. Non-banknote / unsupported denomination (e.g. ₹20 or foreign currency)
const foreignRes = parseCurrencyResult('I see a 20 dollar bill and a book.', false);
assert(foreignRes.recognized === false && foreignRes.denomination === null, 'Unsupported currency does not invent a valid rupee denomination');

const emptyRes = parseCurrencyResult('', false);
assert(emptyRes.recognized === false && emptyRes.denomination === null, 'Empty API response handled cleanly without crashing');

/* ------------------------------------------------------------------
   TEST SUITE 4: SESSION LIFECYCLE & LATE ASYNC GUARD SIMULATION
   ------------------------------------------------------------------ */
console.log('\n--- TEST SUITE 4: Session ID Lifecycle & Late Async Guard ---');

let simulatedSessionCounter = 0;
let simulatedActiveSessionId = 0;
let simulatedIsDetectionActive = false;
let simulatedDetectedCount = 0;
let simulatedProximityLevel = null;
let simulatedAudioPlaying = false;

function startSimulatedDetection() {
  const session = ++simulatedSessionCounter;
  simulatedActiveSessionId = session;
  simulatedIsDetectionActive = true;
  simulatedAudioPlaying = true;
  return session;
}

function stopSimulatedDetection() {
  simulatedActiveSessionId = 0; // Invalidate session
  simulatedIsDetectionActive = false;
  simulatedProximityLevel = null;
  simulatedDetectedCount = 0;
  simulatedAudioPlaying = false;
}

// Test start
const s1 = startSimulatedDetection();
assert(s1 === 1 && simulatedActiveSessionId === 1 && simulatedIsDetectionActive === true && simulatedAudioPlaying === true, 'Detection started with session 1');

// Simulate late async inference
const inFlightSession = s1;

// User stops detection while inference was in flight
stopSimulatedDetection();
assert(simulatedActiveSessionId === 0 && simulatedIsDetectionActive === false && simulatedAudioPlaying === false, 'Detection stopped completely');

// Late async response arrives from inFlightSession:
function onLateAsyncArrival(session, mockPredictions) {
  if (simulatedActiveSessionId !== session || !simulatedIsDetectionActive) {
    // Correctly discarded by session guard!
    return false;
  }
  simulatedDetectedCount = mockPredictions.length;
  simulatedProximityLevel = 'near';
  return true;
}

const didLateResultApply = onLateAsyncArrival(inFlightSession, [{ class: 'person' }]);
assert(didLateResultApply === false, 'Late async result discarded after stopDetection');
assert(simulatedDetectedCount === 0, 'detectedCount remains 0 after discarded late result');
assert(simulatedProximityLevel === null, 'proximityLevel remains null after discarded late result');
assert(simulatedIsDetectionActive === false, 'detection was NOT restarted by late result');

// Restart detection
const s2 = startSimulatedDetection();
assert(s2 === 2 && simulatedActiveSessionId === 2 && simulatedIsDetectionActive === true, 'Detection restarted cleanly with new session 2');

// Repeated stops
stopSimulatedDetection();
stopSimulatedDetection();
stopSimulatedDetection();
assert(simulatedActiveSessionId === 0 && simulatedIsDetectionActive === false, 'Repeated stop calls are safe and idempotent');

/* ------------------------------------------------------------------
   SUMMARY
   ------------------------------------------------------------------ */
console.log('\n====================================================');
console.log(`TOTAL TESTS: ${totalTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${totalTests - passedTests}`);
console.log('====================================================');

process.exit(totalTests === passedTests ? 0 : 1);
