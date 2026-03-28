import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { DayStatus, SessionStartResult } from '../../../packages/shared-types/src/index.js';
import { LearnerEngine } from '../../../packages/core/src/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Pane = 'chat' | 'vocab' | 'progress';

interface VocabHighlight {
  hangul: string;
  romanization: string;
  meaning: string;
  example: string;
}

interface PendingChallenge {
  question: string;
  correctAnswer: string;
  xpReward: number;
}

interface TutorResponse {
  tutorMessage: string;
  romanization: string;
  feedbackNote: string;
  vocabWord: VocabHighlight | null;
  xpDelta: number;
  bonusXp: number;
  streakMaintained: boolean;
  achievement: string | null;
  miniChallenge: PendingChallenge | null;
}

interface ChatMessage {
  role: 'tutor' | 'user';
  text: string;
  romanization?: string;
  feedbackNote?: string;
  vocabWord?: VocabHighlight;
  xpAwarded?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

function buildSystemPrompt(romanizationLevel: number): string {
  return `You are a warm, encouraging Korean language tutor for a beginner learner. Their goals are:
- Understand K-dramas and Korean webnovels (manhwa/light novels)
- Have real conversations with Korean speakers
- Travel to Korea

Current learner level: Beginner (knows Hangul alphabet and basic vocabulary, not yet conversational).
Preferred learning style: gamified, challenge-based, fun.

CONVERSATION STYLE:
- Speak mostly in Korean at a beginner level. Keep sentences short and clear.
- Gently correct errors inline (e.g., "좋아요! But actually: 저는 학생이에요 — note 이에요 after consonant ending").
- Weave in topics from K-dramas, Korean food, travel, and daily life.
- Occasionally use dramatic webnovel/manhwa-style phrasing for fun (e.g., "그 순간, 운명이 바뀌었다...").
- If the user writes in English, respond in Korean with the English meaning in parentheses, to immerse them.

ROMANIZATION:
- Current romanizationLevel: ${romanizationLevel}%
- If romanizationLevel >= 40: include "romanization" field with the romanized pronunciation.
- If romanizationLevel < 40: set "romanization" to "" (the user is weaning off romanization).

MINI-CHALLENGES:
- Every 5–7 messages, insert a miniChallenge to test something they've been practicing.
- Example: { "question": "Quick challenge! How do you say 'I want to eat ramen'? (+10 XP if correct!)", "correctAnswer": "라면을 먹고 싶어요", "xpReward": 10 }
- Otherwise set miniChallenge to null.

XP GUIDELINES:
- xpDelta: base XP for any message (8–15 depending on length/effort)
- bonusXp: extra XP for correct grammar (5), using a new word (5), longer sentence (3)
- streakMaintained: true if no major grammar error, false if there was a significant one to correct

RESPONSE FORMAT:
You MUST respond with ONLY valid JSON — no markdown, no code fences, no extra text. Use this exact shape:
{
  "tutorMessage": "Korean text of your response",
  "romanization": "romanization of tutorMessage (or empty string if level < 40)",
  "feedbackNote": "one-line grammar/usage note (e.g. '✅ Correct subject marker!' or '💡 Use 에서 for locations of action')",
  "vocabWord": { "hangul": "word", "romanization": "romanization", "meaning": "English meaning", "example": "example sentence (e.g. from K-drama)" } or null,
  "xpDelta": 10,
  "bonusXp": 0,
  "streakMaintained": true,
  "achievement": null,
  "miniChallenge": null
}`;
}

// ── Claude API ────────────────────────────────────────────────────────────────

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function callTutor(
  history: ApiMessage[],
  userMessage: string,
  romanizationLevel: number
): Promise<TutorResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set.');
  }

  const messages: ApiMessage[] = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      system: buildSystemPrompt(romanizationLevel),
      messages
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const raw = data.content.find((b) => b.type === 'text')?.text ?? '';

  try {
    return JSON.parse(raw) as TutorResponse;
  } catch {
    // Fallback: treat raw text as a plain tutor message
    return {
      tutorMessage: raw || '죄송해요, 다시 말씀해 주세요.',
      romanization: '',
      feedbackNote: '',
      vocabWord: null,
      xpDelta: 5,
      bonusXp: 0,
      streakMaintained: true,
      achievement: null,
      miniChallenge: null
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderBar(value: number, max: number, width = 20): string {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function deriveLevel(xp: number): { label: string; progress: number; max: number } {
  if (xp < 200) return { label: 'Beginner', progress: xp, max: 200 };
  if (xp < 600) return { label: 'Intermediate', progress: xp - 200, max: 400 };
  return { label: 'Advanced', progress: Math.min(xp - 600, 400), max: 400 };
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ChatPaneProps {
  messages: ChatMessage[];
  isLoading: boolean;
  romanizationLevel: number;
  pendingChallenge: PendingChallenge | null;
  termWidth: number;
}

function ChatPane({ messages, isLoading, romanizationLevel, pendingChallenge, termWidth }: ChatPaneProps): React.ReactElement {
  const showRomanization = romanizationLevel >= 40;
  const dimRomanization = romanizationLevel < 70;
  // Show last N messages based on terminal height (approx 3 lines per message)
  const termHeight = process.stdout.rows || 24;
  const maxMessages = Math.max(3, Math.floor((termHeight - 10) / 3));
  const visible = messages.slice(-maxMessages);

  return (
    <Box flexDirection="column" width={termWidth - 4}>
      {visible.map((msg, i) => (
        <Box key={i} flexDirection="column" marginBottom={0}>
          {msg.role === 'tutor' ? (
            <>
              <Text color="cyan">[튜터] {msg.text}</Text>
              {showRomanization && msg.romanization ? (
                <Text color={dimRomanization ? 'gray' : 'cyan'} dimColor={!dimRomanization}>
                  {'       '}{msg.romanization}
                </Text>
              ) : null}
              {msg.feedbackNote ? (
                <Text color="green">{'  '}{msg.feedbackNote}</Text>
              ) : null}
              {msg.vocabWord ? (
                <Text color="yellow">{'  '}📖 {msg.vocabWord.hangul} ({msg.vocabWord.romanization}) — {msg.vocabWord.meaning}</Text>
              ) : null}
              {msg.xpAwarded != null && msg.xpAwarded > 0 ? (
                <Text color="magenta">{'  '}+{msg.xpAwarded} XP</Text>
              ) : null}
            </>
          ) : (
            <Text color="white">[나]    {msg.text}</Text>
          )}
        </Box>
      ))}
      {isLoading && <Text color="cyan">[튜터] ...</Text>}
      {pendingChallenge && !isLoading && (
        <Box borderStyle="single" marginTop={1}>
          <Text color="yellow">🎯 {pendingChallenge.question}</Text>
        </Box>
      )}
    </Box>
  );
}

interface VocabPaneProps {
  vocab: VocabHighlight[];
}

function VocabPane({ vocab }: VocabPaneProps): React.ReactElement {
  if (vocab.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">단어장이 비어 있어요. Chat to learn words!</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">단어장 — {vocab.length} words learned</Text>
      {vocab.slice(-20).map((item, i) => (
        <Box key={i} flexDirection="column" marginTop={0}>
          <Text><Text color="cyan">{item.hangul}</Text> <Text color="gray">({item.romanization})</Text> — {item.meaning}</Text>
          {item.example ? <Text dimColor>  ex: {item.example}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

interface ProgressPaneProps {
  xp: number;
  streak: number;
  dayStatus: DayStatus;
  grammarStats: { correct: number; total: number };
  vocabCount: number;
  romanizationLevel: number;
}

function ProgressPane({ xp, streak, dayStatus, grammarStats, vocabCount, romanizationLevel }: ProgressPaneProps): React.ReactElement {
  const { label, progress, max } = deriveLevel(xp);
  const levelBar = renderBar(progress, max, 20);
  const accuracyPct = grammarStats.total > 0
    ? Math.round((grammarStats.correct / grammarStats.total) * 100)
    : 0;
  const dailyBar = renderBar(dayStatus.completedSeconds, dayStatus.requiredSeconds, 20);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">진행 — Progress</Text>
      <Text>XP: <Text color="yellow">{xp}</Text>  Level: <Text color="green">{label}</Text></Text>
      <Text>{levelBar} {Math.round((progress / max) * 100)}% to next level</Text>
      <Text>Chat streak: <Text color="magenta">{streak}</Text>  Day streak: <Text color="magenta">{dayStatus.streak}</Text>  Rank: {dayStatus.rank}</Text>
      <Text>Grammar accuracy: <Text color="green">{accuracyPct}%</Text> ({grammarStats.correct}/{grammarStats.total} messages)</Text>
      <Text>Vocab saved: <Text color="cyan">{vocabCount}</Text> words</Text>
      <Text>Romanization support: <Text color="gray">{Math.round(romanizationLevel)}%</Text></Text>
      <Text>Daily: {dayStatus.completedSeconds}s / {dayStatus.requiredSeconds}s</Text>
      <Text>{dailyBar} {Math.round((dayStatus.completedSeconds / Math.max(1, dayStatus.requiredSeconds)) * 100)}%</Text>
    </Box>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

interface DashboardProps {
  engine: LearnerEngine;
}

export default function Dashboard({ engine }: DashboardProps): React.ReactElement {
  const { exit } = useApp();
  const termWidth = process.stdout.columns || 100;

  const [pane, setPane] = useState<Pane>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [romanizationLevel, setRomanizationLevel] = useState(100);
  const [savedVocab, setSavedVocab] = useState<VocabHighlight[]>([]);
  const [achievement, setAchievement] = useState<string | null>(null);
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge | null>(null);
  const [session, setSession] = useState<SessionStartResult | null>(null);
  const [dayStatus, setDayStatus] = useState<DayStatus | null>(null);
  const [grammarStats, setGrammarStats] = useState({ correct: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const apiHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const messageCountRef = useRef(0);
  const inputRef = useRef('');

  // Keep inputRef in sync so useInput closure always sees the latest value
  useEffect(() => { inputRef.current = input; }, [input]);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      setError('ANTHROPIC_API_KEY is not set. Run: export ANTHROPIC_API_KEY=your_key');
      return;
    }
    const started = engine.startSession();
    setSession(started);
    setDayStatus(started.dayStatus);

    // Send an initial greeting message from tutor
    setIsLoading(true);
    callTutor([], '안녕! Start a beginner Korean conversation. Greet the user warmly and ask how they are.', 100)
      .then((res) => {
        const greeting: ChatMessage = {
          role: 'tutor',
          text: res.tutorMessage,
          romanization: res.romanization,
          feedbackNote: undefined,
          vocabWord: res.vocabWord ?? undefined,
          xpAwarded: 0
        };
        setMessages([greeting]);
        apiHistoryRef.current = [{ role: 'assistant', content: res.tutorMessage }];
      })
      .catch((err: unknown) => {
        setMessages([{ role: 'tutor', text: '안녕하세요! 오늘도 화이팅! (Hello! Keep it up today!)', romanization: 'annyeonghaseyo! oneuldo hwaiting!' }]);
        void err;
      })
      .finally(() => setIsLoading(false));
  }, [engine]);

  // ── Achievement helper ─────────────────────────────────────────────────────

  const triggerAchievement = useCallback((text: string) => {
    setAchievement(text);
    setTimeout(() => setAchievement(null), 3500);
  }, []);

  const checkAchievements = useCallback((
    newXp: number,
    newStreak: number,
    newVocabCount: number,
    msgCount: number
  ) => {
    if (msgCount === 1) triggerAchievement('🎉 첫 대화! First Conversation!');
    else if (newStreak === 5) triggerAchievement('🔥 5 Streak! Hot streak!');
    else if (newVocabCount === 1) triggerAchievement('📖 첫 단어! First word saved!');
    else if (newVocabCount === 10) triggerAchievement('📚 단어 10개! 10 words learned!');
    else if (newXp >= 100 && newXp - 20 < 100) triggerAchievement('⭐ 100 XP! Getting started!');
    else if (newXp >= 300 && newXp - 20 < 300) triggerAchievement('🌟 300 XP! Intermediate unlocked!');
  }, [triggerAchievement]);

  // ── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || !session) return;
    setInput('');

    // Check pending challenge
    if (pendingChallenge) {
      const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
      const correct = normalize(trimmed) === normalize(pendingChallenge.correctAnswer);
      const challengeXp = correct ? pendingChallenge.xpReward : 0;
      const challengeMsg: ChatMessage = {
        role: 'user',
        text: trimmed
      };
      const responseMsg: ChatMessage = {
        role: 'tutor',
        text: correct
          ? `정답이에요! 맞았어요! +${challengeXp} XP 🎯`
          : `아쉽네요... 정답은: ${pendingChallenge.correctAnswer}`,
        romanization: correct ? 'jeongdabieyo! majasseoyo!' : 'aswipneyo... jeongdabeun:',
        xpAwarded: challengeXp
      };
      setMessages((prev) => [...prev, challengeMsg, responseMsg]);
      if (correct) setXp((prev) => prev + challengeXp);
      setPendingChallenge(null);
      apiHistoryRef.current.push({ role: 'user', content: trimmed });
      apiHistoryRef.current.push({ role: 'assistant', content: responseMsg.text });
      return;
    }

    // Regular message
    const userMsg: ChatMessage = { role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    messageCountRef.current += 1;

    try {
      const history = apiHistoryRef.current.slice(-18); // last 9 pairs
      const res = await callTutor(history, trimmed, romanizationLevel);

      const totalXp = res.xpDelta + res.bonusXp;
      const newXp = xp + totalXp;
      const newStreak = res.streakMaintained ? streak + 1 : 0;

      // Update grammar stats
      setGrammarStats((prev) => ({
        correct: prev.correct + (res.streakMaintained ? 1 : 0),
        total: prev.total + 1
      }));

      // Save vocab if present
      let newVocabCount = savedVocab.length;
      if (res.vocabWord) {
        const already = savedVocab.some((v) => v.hangul === res.vocabWord!.hangul);
        if (!already) {
          try {
            engine.saveVocab({
              text: res.vocabWord.hangul,
              meaning: res.vocabWord.meaning,
              exampleKo: res.vocabWord.example,
              source: 'chat_tutor'
            });
          } catch { /* non-fatal */ }
          setSavedVocab((prev) => [...prev, res.vocabWord!]);
          newVocabCount += 1;
        }
      }

      // Credit session time
      try {
        const updated = engine.recordChatActivity(session.sessionId, 30);
        setDayStatus(updated);
      } catch { /* non-fatal */ }

      // Romanization fade
      if (res.streakMaintained) {
        setRomanizationLevel((prev) => Math.max(0, prev - 0.5));
      }

      const tutorMsg: ChatMessage = {
        role: 'tutor',
        text: res.tutorMessage,
        romanization: res.romanization,
        feedbackNote: res.feedbackNote || undefined,
        vocabWord: res.vocabWord ?? undefined,
        xpAwarded: totalXp
      };

      setMessages((prev) => [...prev, tutorMsg]);
      setXp(newXp);
      setStreak(newStreak);

      apiHistoryRef.current.push({ role: 'user', content: trimmed });
      apiHistoryRef.current.push({ role: 'assistant', content: res.tutorMessage });

      if (res.miniChallenge) {
        setPendingChallenge(res.miniChallenge);
      }

      if (res.achievement) {
        triggerAchievement(res.achievement);
      } else {
        checkAchievements(newXp, newStreak, newVocabCount, messageCountRef.current);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [
        ...prev,
        { role: 'tutor', text: `오류가 생겼어요. Error: ${errMsg}` }
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, session, pendingChallenge, romanizationLevel, xp, streak, savedVocab, engine, triggerAchievement, checkAchievements]);

  // ── Key input ─────────────────────────────────────────────────────────────
  // Only handle pane/quit shortcuts when the text input is empty, so that
  // typing '1', '2', '3', 'q' in a message does not accidentally trigger them.

  useInput((char, key) => {
    if (key.escape) {
      exit();
      return;
    }
    // Only act on shortcut keys when the input field is empty
    if (inputRef.current.length === 0) {
      if (char === 'q') { exit(); return; }
      if (char === '1') { setPane('chat'); return; }
      if (char === '2') { setPane('vocab'); return; }
      if (char === '3') { setPane('progress'); return; }
      if (char === 'r') {
        setRomanizationLevel((prev) => prev > 50 ? 0 : 100);
        return;
      }
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round">
        <Text color="red">Error: {error}</Text>
        <Text dimColor>Press q to exit.</Text>
      </Box>
    );
  }

  const { label: levelLabel, progress: levelProgress, max: levelMax } = deriveLevel(xp);
  const levelBar = renderBar(levelProgress, levelMax, 14);
  const activePane = pane;

  return (
    <Box flexDirection="column" width={termWidth}>
      {/* Top nav */}
      <Box borderStyle="round" flexDirection="row" paddingX={1}>
        <Text color={activePane === 'chat' ? 'cyan' : 'white'}>[1] 대화{activePane === 'chat' ? ' ✓' : '  '}</Text>
        <Text>  </Text>
        <Text color={activePane === 'vocab' ? 'cyan' : 'white'}>[2] 단어장{activePane === 'vocab' ? ' ✓' : '  '}</Text>
        <Text>  </Text>
        <Text color={activePane === 'progress' ? 'cyan' : 'white'}>[3] 진행{activePane === 'progress' ? ' ✓' : '  '}</Text>
        <Text>    </Text>
        <Text color="yellow">XP:{xp}</Text>
        <Text> {levelBar} </Text>
        <Text color="green">{levelLabel}</Text>
        <Text>  </Text>
        <Text color="red">🔥{streak}</Text>
        <Text>  </Text>
        <Text dimColor>rom:{Math.round(romanizationLevel)}%</Text>
      </Box>

      {/* Content area */}
      <Box borderStyle="round" flexDirection="column" padding={1}>
        {activePane === 'chat' && (
          <ChatPane
            messages={messages}
            isLoading={isLoading}
            romanizationLevel={romanizationLevel}
            pendingChallenge={pendingChallenge}
            termWidth={termWidth}
          />
        )}
        {activePane === 'vocab' && <VocabPane vocab={savedVocab} />}
        {activePane === 'progress' && dayStatus && (
          <ProgressPane
            xp={xp}
            streak={streak}
            dayStatus={dayStatus}
            grammarStats={grammarStats}
            vocabCount={savedVocab.length}
            romanizationLevel={romanizationLevel}
          />
        )}
      </Box>

      {/* Achievement popup */}
      {achievement && (
        <Box borderStyle="double" paddingX={2}>
          <Text color="yellow">🏆 {achievement}</Text>
        </Box>
      )}

      {/* Input */}
      <Box borderStyle="round" flexDirection="row" paddingX={1}>
        <Text color="cyan">{'> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={(v) => { void handleSubmit(v); }}
          placeholder={isLoading ? 'Waiting for tutor...' : 'Type in Korean or English...'}
        />
      </Box>
      <Text dimColor>[q] quit  [1/2/3] switch panes  [r] toggle romanization</Text>
    </Box>
  );
}
