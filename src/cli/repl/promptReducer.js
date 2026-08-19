/**
 * ScanForge Prompt State Machine (useReducer pattern)
 *
 * Deterministic state transitions for the Agent REPL prompt.
 * Manages mode switching between NORMAL typing, COMMAND_PALETTE navigation,
 * and EXECUTING states, preventing race conditions between keystroke routing.
 *
 * Architecture inspired by Charm BubbleTea's Elm pattern and
 * Claude Code's slash command interception model.
 */

import { SLASH_COMMANDS, findMatchingCommands } from './SlashCommands.js';

/**
 * @typedef {'NORMAL' | 'COMMAND_PALETTE' | 'EXECUTING'} PromptMode
 *
 * @typedef {Object} PromptState
 * @property {PromptMode} mode
 * @property {string} rawInput
 * @property {number} highlightedIndex
 * @property {Array} filteredCommands
 * @property {number} scrollOffset
 * @property {number} maxVisible
 * @property {string[]} commandHistory
 * @property {number} historyIndex  (-1 = not browsing history)
 */

export const INITIAL_PROMPT_STATE = {
  mode: 'NORMAL',
  rawInput: '',
  highlightedIndex: 0,
  filteredCommands: [],
  scrollOffset: 0,
  maxVisible: 6,
  commandHistory: [],
  historyIndex: -1,
};

/**
 * Pure reducer — all prompt state transitions happen here.
 * No side effects. Command execution is triggered by the caller
 * when it reads `action.type === 'SUBMIT'`.
 */
export function promptReducer(state, action) {
  switch (action.type) {
    // ── Text input changed ──────────────────────────────────────────
    case 'INPUT_CHANGE': {
      const text = action.text;
      const isSlash = text.startsWith('/');

      if (isSlash) {
        const filtered = findMatchingCommands(text);
        return {
          ...state,
          rawInput: text,
          mode: 'COMMAND_PALETTE',
          filteredCommands: filtered,
          highlightedIndex: 0,
          scrollOffset: 0,
          historyIndex: -1,
        };
      }

      return {
        ...state,
        rawInput: text,
        mode: 'NORMAL',
        filteredCommands: [],
        highlightedIndex: 0,
        scrollOffset: 0,
        historyIndex: -1,
      };
    }

    // ── Arrow Down in palette ───────────────────────────────────────
    case 'NAVIGATE_DOWN': {
      if (state.mode !== 'COMMAND_PALETTE' || !state.filteredCommands.length) {
        // In NORMAL mode, browse command history forward
        if (state.mode === 'NORMAL' && state.historyIndex >= 0) {
          const nextIdx = state.historyIndex - 1;
          return {
            ...state,
            historyIndex: nextIdx,
            rawInput: nextIdx >= 0
              ? state.commandHistory[state.commandHistory.length - 1 - nextIdx] || ''
              : '',
          };
        }
        return state;
      }

      const nextHighlight = (state.highlightedIndex + 1) % state.filteredCommands.length;
      // Adjust scroll window to keep highlighted item visible
      let nextScroll = state.scrollOffset;
      if (nextHighlight >= nextScroll + state.maxVisible) {
        nextScroll = nextHighlight - state.maxVisible + 1;
      }
      if (nextHighlight < nextScroll) {
        nextScroll = nextHighlight;
      }
      // Wrap-around to top
      if (nextHighlight === 0) {
        nextScroll = 0;
      }

      return {
        ...state,
        highlightedIndex: nextHighlight,
        scrollOffset: nextScroll,
      };
    }

    // ── Arrow Up in palette ─────────────────────────────────────────
    case 'NAVIGATE_UP': {
      if (state.mode !== 'COMMAND_PALETTE' || !state.filteredCommands.length) {
        // In NORMAL mode, browse command history backward
        if (state.mode === 'NORMAL' && state.commandHistory.length > 0) {
          const nextIdx = Math.min(state.historyIndex + 1, state.commandHistory.length - 1);
          return {
            ...state,
            historyIndex: nextIdx,
            rawInput: state.commandHistory[state.commandHistory.length - 1 - nextIdx] || '',
          };
        }
        return state;
      }

      const prevHighlight = state.highlightedIndex === 0
        ? state.filteredCommands.length - 1
        : state.highlightedIndex - 1;

      let prevScroll = state.scrollOffset;
      if (prevHighlight < prevScroll) {
        prevScroll = prevHighlight;
      }
      if (prevHighlight >= prevScroll + state.maxVisible) {
        prevScroll = prevHighlight - state.maxVisible + 1;
      }
      // Wrap-around to bottom
      if (prevHighlight === state.filteredCommands.length - 1) {
        prevScroll = Math.max(0, state.filteredCommands.length - state.maxVisible);
      }

      return {
        ...state,
        highlightedIndex: prevHighlight,
        scrollOffset: prevScroll,
      };
    }

    // ── Tab / Enter on a suggestion → auto-complete into input ──────
    case 'SELECT_CURRENT': {
      if (state.mode !== 'COMMAND_PALETTE' || !state.filteredCommands.length) {
        return state;
      }
      const selected = state.filteredCommands[state.highlightedIndex];
      if (!selected) return state;

      const filled = selected.args
        ? `${selected.name} `   // leave space for argument typing
        : selected.name;       // no args → ready to submit

      return {
        ...state,
        mode: 'NORMAL',
        rawInput: filled,
        filteredCommands: [],
        highlightedIndex: 0,
        scrollOffset: 0,
      };
    }

    // ── Escape → dismiss palette, keep text ─────────────────────────
    case 'DISMISS_PALETTE': {
      return {
        ...state,
        mode: 'NORMAL',
        filteredCommands: [],
        highlightedIndex: 0,
        scrollOffset: 0,
      };
    }

    // ── Submit (Enter in NORMAL mode) ───────────────────────────────
    case 'SUBMIT': {
      const text = state.rawInput.trim();
      if (!text) return state;

      return {
        ...state,
        mode: 'NORMAL',
        rawInput: '',
        filteredCommands: [],
        highlightedIndex: 0,
        scrollOffset: 0,
        commandHistory: [...state.commandHistory, text],
        historyIndex: -1,
      };
    }

    // ── Mark execution start/end ────────────────────────────────────
    case 'SET_EXECUTING': {
      return { ...state, mode: action.value ? 'EXECUTING' : 'NORMAL' };
    }

    default:
      return state;
  }
}
