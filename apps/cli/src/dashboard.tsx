import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { DayStatus, Exercise, SessionStartResult } from '../../../packages/shared-types/src/index.js';
import { LearnerEngine, clampNumber } from '../../../packages/core/src/index.js';

interface DashboardProps {
  engine: LearnerEngine;
}

function renderProgress(current: number, required: number, width = 30): string {
  const ratio = required > 0 ? Math.min(1, current / required) : 0;
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function normalizeInput(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export default function Dashboard({ engine }: DashboardProps): React.ReactElement {
  const { exit } = useApp();
  const terminalWidth = process.stdout.columns || 100;
  const [session, setSession] = useState<SessionStartResult | null>(null);
  const [status, setStatus] = useState<DayStatus | null>(null);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [feedback, setFeedback] = useState('Strict Coach: Stay locked in. Every attempt counts.');
  const [gateUnlocked, setGateUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastInteractionRef = useRef<number>(Date.now());

  useEffect(() => {
    try {
      const started = engine.startSession();
      setSession(started);
      setStatus(started.dayStatus);
      setExercise(engine.getNextExercise(started.sessionId));
      lastInteractionRef.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session.');
    }
  }, [engine]);

  const canSubmitTyped = useMemo(() => {
    if (!exercise || exercise.mode !== 'typed') {
      return false;
    }
    return normalizeInput(typedAnswer).length > 0;
  }, [exercise, typedAnswer]);

  const submitAttempt = (correct: boolean, answerText: string): void => {
    if (!session || !exercise) {
      return;
    }

    const now = Date.now();
    const elapsed = Math.round((now - lastInteractionRef.current) / 1000);
    const activeSecondsDelta = clampNumber(elapsed, 15, 90);

    try {
      const result = engine.recordAttempt({
        sessionId: session.sessionId,
        exerciseId: exercise.id,
        vocabId: exercise.vocabId,
        category: exercise.category,
        promptMode: exercise.mode,
        correct,
        answerText,
        responseMs: elapsed * 1000,
        activeSecondsDelta,
        attemptedAt: new Date().toISOString()
      });

      setStatus(result.dayStatus);
      setFeedback(`${result.feedback} ${correct ? 'Good. Keep pressure.' : 'Review this again soon.'}`);
      setTypedAnswer('');
      setGateUnlocked(result.gateUnlocked);
      lastInteractionRef.current = now;

      if (!result.gateUnlocked) {
        setExercise(engine.getNextExercise(session.sessionId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record attempt.');
    }
  };

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      exit();
      return;
    }

    if (!exercise || gateUnlocked) {
      return;
    }

    if (exercise.mode === 'choice' && ['1', '2', '3', '4'].includes(input)) {
      const index = Number(input) - 1;
      const selected = exercise.options?.[index];
      if (!selected) {
        return;
      }
      submitAttempt(selected === exercise.correctAnswer, selected);
    }

    if (exercise.mode === 'typed' && key.return && canSubmitTyped) {
      submitAttempt(normalizeInput(typedAnswer) === normalizeInput(exercise.correctAnswer), typedAnswer);
    }
  });

  if (error) {
    return (
      <Box borderStyle="round" flexDirection="column" padding={1}>
        <Text color="red">Error: {error}</Text>
        <Text>Press q to exit.</Text>
      </Box>
    );
  }

  if (!status || !exercise || !session) {
    return <Text>Starting session...</Text>;
  }

  const progressBar = renderProgress(status.completedSeconds, status.requiredSeconds, Math.max(20, Math.floor(terminalWidth * 0.45)));
  const completionPercent = Math.round((status.completedSeconds / Math.max(1, status.requiredSeconds)) * 100);

  return (
    <Box flexDirection="column" width={terminalWidth} padding={1}>
      <Box borderStyle="round" flexDirection="column" padding={1}>
        <Text color="cyan">Local Korean Trainer | Strict Coach Mode</Text>
        <Text>
          Date: {status.date} | Streak: {status.streak} | Rank: {status.rank}
        </Text>
        <Text>
          Required: {status.requiredSeconds}s | Completed: {status.completedSeconds}s | Debt: {status.debtSeconds}s
        </Text>
        <Text>{progressBar} {completionPercent}%</Text>
      </Box>

      <Box borderStyle="round" flexDirection="column" padding={1} marginTop={1}>
        <Text color="yellow">Current Drill ({exercise.category.toUpperCase()} / {exercise.mode.toUpperCase()})</Text>
        <Text>{exercise.prompt}</Text>
        {exercise.mode === 'choice' && (
          <Box flexDirection="column" marginTop={1}>
            {(exercise.options || []).map((option, index) => (
              <Text key={option}>{index + 1}. {option}</Text>
            ))}
            <Text color="gray">Press 1-4 to answer.</Text>
          </Box>
        )}
        {exercise.mode === 'typed' && (
          <Box flexDirection="column" marginTop={1}>
            <TextInput
              value={typedAnswer}
              onChange={setTypedAnswer}
              onSubmit={(value) => {
                submitAttempt(normalizeInput(value) === normalizeInput(exercise.correctAnswer), value);
              }}
            />
            <Text color="gray">Type Hangul answer and press Enter.</Text>
          </Box>
        )}
      </Box>

      <Box borderStyle="round" flexDirection="column" padding={1} marginTop={1}>
        <Text>{feedback}</Text>
        {gateUnlocked ? (
          <Text color="green">Gate unlocked for today. Session complete. Press q to exit.</Text>
        ) : (
          <Text color="gray">Press q anytime to exit. Session progress is saved.</Text>
        )}
      </Box>
    </Box>
  );
}
