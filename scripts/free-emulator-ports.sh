#!/usr/bin/env bash
# Free the Firebase emulator ports, killing whatever still holds them.
#
# Why this exists: a killed or crashed run leaves emulators squatting on these
# ports. The next run then talks to a HALF-DEAD emulator — one that answers on
# the port but has no functions registered — and every callable 404s. In the
# browser that surfaces as "blocked by CORS policy" (a 404 carries no CORS
# headers) and the app shows a bare "internal", so the symptom points at the
# app, not at the leftover process. Cost hours on 2026-07-20.
#
# Look up owners BY PORT, never `pkill -f firebase`: a pattern like that also
# matches this script's own command line (and the agent shell that spawned it),
# so the "cleanup" kills the caller — observed as a shell exiting with 144.
set -uo pipefail

PORTS=(61100 61101 61102 61103 61104 61105 61106 61107)
CALLER_PIDS=" $$ $PPID "

pids_on_port() {
  ss -lptn "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u
}

# The leftovers that hold NO port, and so survive everything above.
#
# When a run is killed, the functions emulator's Node runtime workers can outlive
# it and reparent to init at ~150 MB each. Every port check says the block is
# clear, so the next run starts happily and leaks another batch. Measured after
# three interrupted runs: twelve orphans, ~1.7 GB.
#
# The damage lands on a LATER run, which is what makes it so confusing: a long
# browser suite dies partway with ERR_CONNECTION_REFUSED against its own dev
# server, at a different screen each time, and the dev server's log ends with no
# error at all. It reads as a bug in whatever you changed most recently. It cost
# two failed sweeps and a wrong hypothesis on 2026-08-28.
#
# Matched by cwd, not by name: sibling checkouts on this machine run the exact
# same binary, and killing theirs is the thing this whole port scheme exists to
# stop. ppid==1 is what distinguishes an orphan from a worker belonging to a run
# that is legitimately in progress right now.
reap_orphaned_runtimes() {
  local repo_functions orphans=()
  repo_functions="$(cd "$(dirname "$0")/../functions" && pwd)"

  # NOT pgrep: `pgrep -f firebase-tools` matches this script's own command line
  # and the agent shell that spawned it — the exact trap documented at the top of
  # this file (a shell exiting 144). Reading ps and filtering by ppid and cwd
  # cannot match the caller by accident.
  # shellcheck disable=SC2009
  while read -r pid ppid _; do
    [ "$ppid" = "1" ] || continue
    case "$CALLER_PIDS" in *" $pid "*) continue ;; esac
    [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$repo_functions" ] || continue
    orphans+=("$pid")
  done < <(ps -eo pid,ppid,args --no-headers | grep '[f]irebase-tools')

  [ ${#orphans[@]} -eq 0 ] && return 0
  echo "reaping ${#orphans[@]} orphaned functions runtime(s): ${orphans[*]}"
  kill "${orphans[@]}" 2>/dev/null || true
}

victims=()
for p in "${PORTS[@]}"; do
  for pid in $(pids_on_port "$p"); do
    # Never kill ourselves or our parent, whatever is listening.
    case "$CALLER_PIDS" in *" $pid "*) continue ;; esac
    victims+=("$pid")
  done
done

if [ ${#victims[@]} -eq 0 ]; then
  echo "emulator ports clear"
  reap_orphaned_runtimes
  exit 0
fi

uniq_victims=$(printf '%s\n' "${victims[@]}" | sort -u)
echo "freeing emulator ports; terminating: $(echo "$uniq_victims" | tr '\n' ' ')"
# shellcheck disable=SC2086
kill $uniq_victims 2>/dev/null
for _ in $(seq 1 20); do
  still=""
  for p in "${PORTS[@]}"; do still="$still$(pids_on_port "$p")"; done
  [ -z "$still" ] && break
  sleep 0.5
done
for p in "${PORTS[@]}"; do
  for pid in $(pids_on_port "$p"); do
    case "$CALLER_PIDS" in *" $pid "*) continue ;; esac
    echo "  port $p still held by $pid — SIGKILL"
    kill -9 "$pid" 2>/dev/null
  done
done
sleep 1
echo "emulator ports clear"

reap_orphaned_runtimes
