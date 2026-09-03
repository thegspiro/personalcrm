### Hold the tag before judging it — 2026-09-03

*Schema: none*

#### Fixed
- **A tag that becomes private-only mid-request can no longer be put on
  somebody while the lock is closed.** A tag nobody carries is safe to use
  while locked, because it says nothing about anybody — but another tab could
  put it on someone private in the moment between that judgement and the write,
  and the assignment went ahead, publishing the tag's name through its new
  visible use. The tag is now held for the write, so the answer cannot go stale
  between asking and acting.
- **An email change no longer goes through on a password that has since been
  changed.** Changing your password is how you take an account back, and it
  ends every other session — but an email change already in flight on one of
  them had confirmed the old password a moment earlier and wrote anyway, so the
  address the account signs in with could still be moved afterwards. It now
  applies only if the password is still the one that was confirmed.
