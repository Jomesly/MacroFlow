'use client';
import { useEffect, useState } from 'react';
import { SETUP_TAGS } from './types';
import { journalFetch } from './journal-fetch';
export function useSetupTags() {
  const [tags, setTags] = useState<readonly string[]>(SETUP_TAGS);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const response = await journalFetch('/api/journal/setup-tags'); if (response.ok) { const body = await response.json(); if (active) setTags(body.tags); } } catch { /* Default choices remain available. */ } };
    void load(); window.addEventListener('journal-tags-changed', load);
    return () => { active = false; window.removeEventListener('journal-tags-changed', load); };
  }, []);
  return tags;
}
