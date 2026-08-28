"""
lab_matching.py

Specialized-labs room matching for the automated scheduling system.

scheduler.py's HC-05 check today only asks "is this a LAB-type room or not."
This module adds a second, finer question on top of that: for LAB-type sessions,
does the room's specialization (lab_cat) match what the class actually needs
(e.g. a CISCO/Networking session must land in a CISCO/Networking room, not just
any lab)?

Extended to also cover the lecture side: a non-lab session isn't just "any
lecture room" either. SJH's 5th floor (GENED) is for General Education and
pure-lecture SoC courses; the 6th floor (SPLITLEC) is reserved specifically
for the lecture half of SPLIT-type courses. Which one a session needs is
inferred from its own schedtype rather than requiring a new field on the
Gene/class_requirements side: scheduler.py's default meeting expansion
already gives a SPLIT course's lecture half a distinct duration (LEC_2H)
from a plain lecture course's meetings (LEC_1.5H) — that existing
distinction is reused here rather than duplicated.

Expects room_info values to be a small dict, not a bare string:
    room_info[room_name] = {
        "room_type": "LAB" | "LEC",
        "lab_cat": "CISCO" | ...,                  # only meaningful for LAB rooms
        "lec_cat": "GENED" | "SPLITLEC" | "NONE",  # only meaningful for LEC rooms
    }

Matching is intentionally strict: a session with lab_cat = "COMPUTER" will not
match a "CISCO" room even if the CISCO room is empty at that timeslot, and vice
versa. The one wildcard case is a LAB-type session whose lab_cat is "NONE" (this
happens today when a plain LAB subject has no lab_cat set in the curriculum,
since load_data_from_json defaults it to "NONE" rather than "COMPUTER" the way
SPLIT subjects do) — that session is treated as "any lab room is acceptable,"
matching the coarse-only behavior scheduler.py already has today. If that
NONE-default turns out to be unintentional, aligning it to "COMPUTER" in the
curriculum data would make matching for those sessions specific instead of a
wildcard — a data change, not something this module needs to decide.

The lecture side has its own, separate wildcard: a room with no lec_cat
recorded (the key is simply absent, which is what every existing room_info
looks like before this feature) is treated as accepting either GENED or
SPLITLEC sessions. That's deliberate — it means this change is safe to ship
even before rooms.json or the live database actually carries lec_cat data;
nothing breaks, the new distinction just isn't enforced until the room data
catches up.
"""

DEFAULT_ROOM_META = {"room_type": "LEC", "lab_cat": "NONE", "lec_cat": "NONE"}


def _is_lab_session(schedtype):
    return "LAB" in str(schedtype).upper()


def _lec_cat_for_session(schedtype):
    """Which lecture room sub-pool does a non-lab session need?

    LEC_2H is specifically the lecture half of a SPLIT course's default
    expansion (see scheduler.py's load_data_from_json) — nothing else
    produces that duration. Everything else non-lab (LEC_1.5H, or any other
    literal lecture-flavored schedtype) is a plain lecture-only meeting,
    whether it's genuinely General Education or a pure-lecture SoC subject
    like 6CFUN — both share the same 5th-floor pool, so both resolve here
    to the same category rather than needing to be told apart by subject code.
    """
    return "SPLITLEC" if str(schedtype).upper() == "LEC_2H" else "GENED"


def is_valid_room(schedtype, lab_cat, room_meta):
    """
    Does a single room satisfy a single gene's room requirement?

    schedtype: the gene's SCHEDTYPE (e.g. "LAB_3H", "LEC_1.5H")
    lab_cat:   the gene's lab_cat requirement (e.g. "CISCO", "NONE")
    room_meta: room_info[room_name], a dict with "room_type" and "lab_cat"
    """
    if room_meta is None:
        room_meta = DEFAULT_ROOM_META

    room_type = str(room_meta.get("room_type", "LEC")).upper()
    room_cat = str(room_meta.get("lab_cat", "NONE")).upper()
    needs_lab = _is_lab_session(schedtype)

    if not needs_lab:
        if room_type == "LAB":
            return False
        room_lec_cat = str(room_meta.get("lec_cat", "NONE")).upper()
        if room_lec_cat in ("NONE", "", "NAN"):
            # Room has no lecture sub-category recorded — wildcard, same
            # spirit as the lab side's NONE handling. Keeps this backward
            # compatible with any room_info built before this field existed.
            return True
        return room_lec_cat == _lec_cat_for_session(schedtype)

    if room_type != "LAB":
        return False

    session_cat = str(lab_cat).upper()
    if session_cat in ("NONE", "", "NAN"):
        # No specific category required — any lab room qualifies (wildcard).
        return True

    return room_cat == session_cat


def get_valid_rooms(schedtype, lab_cat, room_info):
    """
    Which rooms in room_info satisfy a gene's requirement?

    Returns the exact lab_cat match first. If that's empty (e.g. a category
    with no rooms currently registered for it), falls back to any room of the
    right coarse type (LAB vs LEC) so a single missing category doesn't strand
    that gene — the caller's own fallback to available_rooms remains the final
    safety net if even that comes back empty, unchanged from today.
    """
    exact = [
        room_name for room_name, meta in room_info.items()
        if is_valid_room(schedtype, lab_cat, meta)
    ]
    if exact:
        return exact

    needs_lab = _is_lab_session(schedtype)
    coarse = [
        room_name for room_name, meta in room_info.items()
        if (str(meta.get("room_type", "LEC")).upper() == "LAB") == needs_lab
    ]
    return coarse
