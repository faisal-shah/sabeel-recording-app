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

PORTS=(4000 4400 4500 5001 8080 9099 9150 9199)
CALLER_PIDS=" $$ $PPID "

pids_on_port() {
  ss -lptn "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u
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
