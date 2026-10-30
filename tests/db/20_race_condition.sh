#!/usr/bin/env bash
# Fires 10 bookings for the SAME dentist and SAME time slot in parallel.
# Exactly ONE must succeed; the other nine must get SLOT_UNAVAILABLE.
set -uo pipefail
PSQL="${PSQL:-psql -h /tmp -p 5433 -U postgres}"
DB="${DB:-smileslot_test}"

SLOT=$($PSQL -d "$DB" -Atq -c "
  select slot_start from public.get_available_slots('20000000-0000-4000-8000-000000000002',
    (current_date + 20), '30000000-0000-4000-8000-000000000001') limit 1")
if [ -z "$SLOT" ]; then
  SLOT=$($PSQL -d "$DB" -Atq -c "
    select slot_start from public.get_available_slots('20000000-0000-4000-8000-000000000002',
      (current_date + 21), '30000000-0000-4000-8000-000000000001') limit 1")
fi
echo "Racing 10 parallel bookings for $SLOT"

TMP=$(mktemp -d)
for i in $(seq 1 10); do
  $PSQL -d "$DB" -Atq -c "set role anon; select reference_code from public.book_appointment(
    '20000000-0000-4000-8000-000000000002', '$SLOT', 'Racer $i', 'racer$i@x.local', '0917000000$i',
    '30000000-0000-4000-8000-000000000001')" > "$TMP/$i.out" 2>&1 &
done
wait

OK=$(grep -lE '^[1-9][0-9]{7}$' "$TMP"/*.out | wc -l)
BLOCKED=$(grep -l 'SLOT_UNAVAILABLE' "$TMP"/*.out | wc -l)
rm -rf "$TMP"
echo "succeeded=$OK blocked=$BLOCKED"
if [ "$OK" -eq 1 ] && [ "$BLOCKED" -eq 9 ]; then
  echo "PASS: 10 simultaneous requests for one slot → exactly 1 booking"
else
  echo "FAIL: expected 1 success and 9 blocked"; exit 1
fi
