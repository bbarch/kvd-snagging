"""KVD Windpark snag checklist: single source for the Excel workbook and the web app."""
import json

TEAMS = [
    ("civil", "Civil & Masonry"),
    ("plaster", "Plaster & POP"),
    ("paint", "Painting"),
    ("tiling", "Tiling & Stone"),
    ("carpentry", "Carpentry (wooden doors)"),
    ("fenestration", "Aluminium / uPVC"),
    ("glazing", "Glass & Glazing"),
    ("electrical", "Electrical"),
    ("plumbing", "Plumbing & Sanitary"),
    ("waterproofing", "Waterproofing"),
    ("hvac", "HVAC"),
    ("fire", "Fire Fighting"),
    ("fabrication", "MS / SS Fabrication"),
    ("housekeeping", "Housekeeping"),
]

SEVERITY = [
    ("critical", "Critical", "Safety, structure, water ingress or statutory item. Blocks handover. Target fix: 48 hours."),
    ("major", "Major", "Function affected or visible defect a buyer will reject. Blocks handover. Target fix: 7 days."),
    ("minor", "Minor", "Cosmetic or finishing. Can be accepted by the buyer at handover with a fix date. Target fix: 14 days."),
]

# (id, check, acceptance criterion / method, team, severity)
GROUPS = {
    "CEIL": ("Ceiling", [
        ("CEIL-01", "Ceiling surface even, no undulation, cracks or patch marks", "Torch held flat to the surface; no visible waves or patch outlines", "plaster", "minor"),
        ("CEIL-02", "No dampness, seepage stains or efflorescence", "Look hard below toilets of the flat above and below the terrace on top floors", "waterproofing", "major"),
        ("CEIL-03", "Paint uniform, no patchiness, brush marks, drips or shade difference", "View in daylight and with lights on", "paint", "minor"),
        ("CEIL-04", "Beam soffits and edges straight, arrises true", "Sight along the edge; no wavy lines", "plaster", "minor"),
        ("CEIL-05", "False ceiling / cornice (if any) level, joints invisible, no sagging", "Spirit level at 2-3 spots", "plaster", "minor"),
        ("CEIL-06", "Light and fan points at drawing location, boxes flush, cut-outs neat", "Compare with electrical layout", "electrical", "minor"),
        ("CEIL-07", "Sprinkler / smoke detector at drawing location, cap removed, not painted over", "Compare with fire drawing", "fire", "critical"),
    ]),
    "WALL": ("Walls, plaster & paint", [
        ("WAL-01", "Plaster true and plumb", "2 m straight edge in both directions; gap within project spec (typically 3-4 mm)", "plaster", "minor"),
        ("WAL-02", "No hollow or drummy plaster", "Tap with a wooden mallet or knuckle over the full wall", "plaster", "major"),
        ("WAL-03", "No cracks at RCC-masonry junctions, lintels, frame edges or chase lines", "Hairline: mark for mesh repair. Wider than 0.3 mm or recurring: refer to structural", "plaster", "major"),
        ("WAL-04", "Corners and edges straight, vertical and square; no chipped arrises", "Try square at corners; sight along edges", "plaster", "minor"),
        ("WAL-05", "Paint uniform shade, no patchiness, roller marks, runs, pinholes or putty showing", "Daylight and artificial light", "paint", "minor"),
        ("WAL-06", "No paint splashes on switches, frames, glass, tiles or floor", "Visual", "paint", "minor"),
        ("WAL-07", "No dampness, blistering, peeling or efflorescence", "Check walls shared with toilets, external walls and shafts; moisture meter if available", "waterproofing", "major"),
        ("WAL-08", "Surface around switchboards, AC sleeves and pipe penetrations neatly finished", "Visual", "plaster", "minor"),
        ("WAL-09", "No nails, binding wire, tie-rod holes or rust marks visible", "Visual", "civil", "minor"),
    ]),
    "FLR": ("Flooring", [
        ("FLR-01", "Tiles / stone of approved make, size and shade; no shade variation in the room", "Compare with approved sample; check batch on cartons if still on site", "tiling", "minor"),
        ("FLR-02", "No hollow-sounding tiles", "Tap every tile with a rubber mallet or coin", "tiling", "major"),
        ("FLR-03", "Lippage between tiles within limit and floor level", "Straight edge across joints; lippage not more than 1 mm; no ponding", "tiling", "minor"),
        ("FLR-04", "Joints uniform, straight and fully grouted in approved colour", "Visual; spacers used; no open joints", "tiling", "minor"),
        ("FLR-05", "No cracked or broken tiles", "Visual", "tiling", "major"),
        ("FLR-06", "No chipped edges, scratches or stains on tiles", "Visual, torch at low angle", "tiling", "minor"),
        ("FLR-07", "Cut pieces neat; layout symmetric; no thin slivers at visible edges", "Visual", "tiling", "minor"),
        ("FLR-08", "Door threshold level with floors on both sides, no trip edge", "Straight edge across threshold", "tiling", "minor"),
        ("FLR-09", "Floor clean of cement slurry, grout haze and paint", "Visual", "housekeeping", "minor"),
    ]),
    "SKT": ("Skirting", [
        ("SKT-01", "Skirting height uniform, top edge straight, projection uniform", "Visual, measure at 2-3 points", "tiling", "minor"),
        ("SKT-02", "No gap between skirting and floor; joints aligned with floor joints", "Visual", "tiling", "minor"),
        ("SKT-03", "No loose or hollow skirting pieces", "Tap test", "tiling", "minor"),
    ]),
    "DRI": ("Internal wooden door", [
        ("DRI-01", "Frame plumb and square, firmly fixed; gap to wall filled and finished", "Spirit level on jambs; push test on frame", "carpentry", "minor"),
        ("DRI-02", "Frame free of cracks, splits and termite signs", "Visual along full length, specially the bottom", "carpentry", "major"),
        ("DRI-03", "Shutter flat, not warped; veneer / laminate not delaminated, dented or scratched", "Straight edge diagonally on shutter face", "carpentry", "minor"),
        ("DRI-04", "Uniform gap between shutter and frame; clearance under shutter as per spec", "About 3 mm at sides and top; confirm bottom gap with spec (usually 6-10 mm)", "carpentry", "minor"),
        ("DRI-05", "Shutter swings full without binding and stays where left half-open", "Open and close 5 times", "carpentry", "minor"),
        ("DRI-06", "Hinges: minimum 3 nos, all screws fitted, no squeak", "Count screws", "carpentry", "minor"),
        ("DRI-07", "Lock / latch works, strike plate aligned, all keys operate", "Try every key; latch engages without pushing the door", "carpentry", "major"),
        ("DRI-08", "Handles, tower bolts and door stopper fitted, tight and undamaged", "Visual and hand test", "carpentry", "minor"),
        ("DRI-09", "Polish / paint / laminate edges uniform; all six edges of shutter sealed", "Check top and bottom edges with a mirror", "carpentry", "minor"),
        ("DRI-10", "Toilet door: water-resistant shutter and bottom edge sealed", "Confirm spec (WPC / PVC-faced flush)", "carpentry", "major"),
    ]),
    "DRM": ("Main entrance door", [
        ("DRM-01", "Door make, rating and finish as approved", "Check label / spec sheet", "carpentry", "major"),
        ("DRM-02", "Main lock and night latch work; all keys operate", "Try every key from both sides", "carpentry", "major"),
        ("DRM-03", "Door viewer fitted at correct height with clear view", "About 1500 mm from floor", "carpentry", "minor"),
        ("DRM-04", "Door closer (if provided) closes and latches smoothly", "Release from fully open 3 times", "carpentry", "minor"),
        ("DRM-05", "Flat number plate fixed with correct number", "Visual", "civil", "minor"),
        ("DRM-06", "Marble / granite threshold level; no gap under door on lobby side", "Visual", "tiling", "minor"),
        ("DRM-07", "Smoke / weather seal (if specified) continuous", "Visual", "carpentry", "minor"),
    ]),
    "WIN": ("Windows & sliding doors (aluminium / uPVC)", [
        ("WIN-01", "Profile, colour and make as approved; frame plumb and square", "Spirit level; compare with approved sample", "fenestration", "minor"),
        ("WIN-02", "Frame-to-wall joint sealed inside and outside; no gaps or daylight", "Visual from inside with room lights off", "fenestration", "major"),
        ("WIN-03", "No leakage under water test", "Hose on the outside for 10-15 min; check frame, sill and glass edges", "fenestration", "major"),
        ("WIN-04", "Sashes slide / open smoothly; rollers free; no rattle", "Operate full travel 5 times", "fenestration", "minor"),
        ("WIN-05", "Locks, handles and crescent locks engage fully; friction stays hold", "Operate each", "fenestration", "minor"),
        ("WIN-06", "No cracked or broken glass", "Visual", "glazing", "major"),
        ("WIN-07", "Glass of correct type (toughened / frosted in toilets), no scratches or bubbles, labels removed", "Check toughened stamp", "glazing", "minor"),
        ("WIN-08", "Gaskets and brush seals complete; glazing beads tight", "Run a finger along", "fenestration", "minor"),
        ("WIN-09", "Drainage slots in bottom track open; track clear of mortar", "Pour water in the track; it should drain out", "fenestration", "major"),
        ("WIN-10", "Mosquito mesh shutter fitted and slides (if in scope)", "Operate", "fenestration", "minor"),
        ("WIN-11", "Sill slopes outward; external sill has drip groove; joints sealed", "Visual, spirit level", "tiling", "minor"),
        ("WIN-12", "Safety grill / child guard on low-sill windows as specified", "Low sill = below about 900 mm", "fabrication", "critical"),
        ("WIN-13", "Protective film removed; no cement or paint on frames", "Visual", "housekeeping", "minor"),
    ]),
    "ELC": ("Electrical points", [
        ("ELC-01", "Switches and sockets as per layout: count, position and height", "Compare with electrical layout", "electrical", "minor"),
        ("ELC-02", "Plates level and flush, all screws and caps fitted, no cracked plates", "Visual", "electrical", "minor"),
        ("ELC-03", "Every switch controls its point; every socket passes socket tester", "Socket tester for polarity and earth", "electrical", "major"),
        ("ELC-04", "Fan hook in RCC at fan point, secure; regulator point provided", "Pull test on hook", "electrical", "major"),
        ("ELC-05", "No loose wires or open boxes; blanking plates on unused boxes", "Visual", "electrical", "critical"),
        ("ELC-06", "TV / data / telephone points as per layout with draw wire in conduit", "Visual", "electrical", "minor"),
    ]),
    "AC": ("Air-conditioning provision", [
        ("AC-01", "AC socket (16/20 A) near indoor unit location at correct height", "Compare with layout", "electrical", "minor"),
        ("AC-02", "AC sleeve through wall at correct position, sloping out, capped", "Visual", "hvac", "minor"),
        ("AC-03", "Condensate drain provision connected and tested", "Pour water into drain point; confirm discharge", "hvac", "major"),
        ("AC-04", "Outdoor unit ledge / bracket position safe and reachable for service", "Visual from balcony / ledge", "hvac", "minor"),
        ("AC-05", "Pre-installed copper piping (if any) pressure tested and capped", "Test record", "hvac", "minor"),
    ]),
    "BR": ("Bedroom extras", [
        ("BR-01", "Wardrobe (if in scope): shutters aligned, hinges, handles and drawers work, no swelling", "Operate each shutter and drawer", "carpentry", "minor"),
        ("BR-02", "Bedside switches / two-way switching as per layout", "Test both ends", "electrical", "minor"),
    ]),
    "FOY": ("Foyer extras", [
        ("FOY-01", "Video door phone / intercom calls security and lobby", "Place a test call both ways", "electrical", "major"),
        ("FOY-02", "Bell push outside and chime inside work", "Test", "electrical", "minor"),
    ]),
    "WET": ("Wet area floor & waterproofing", [
        ("WET-01", "Waterproofing done and 72-hr ponding test record available", "Check QA record for this flat", "waterproofing", "critical"),
        ("WET-02", "No dampness in ceiling of flat below or adjoining walls", "Check the flat below at the same position", "waterproofing", "critical"),
        ("WET-03", "Floor slopes to floor trap with no ponding", "Pour a bucket of water; about 1:100 slope", "tiling", "major"),
        ("WET-04", "Floor trap with grating, water seal present, grating flush with tiles", "Visual; pour water to check seal", "plumbing", "major"),
        ("WET-05", "Shower area level drop / step as specified", "Visual", "tiling", "minor"),
        ("WET-06", "Joints around trap, WC and pipe entries sealed (epoxy / silicone)", "Visual", "plumbing", "major"),
    ]),
    "DAD": ("Wall tiles / dado", [
        ("DAD-01", "Dado to specified height; top edge straight and finished", "Measure; trim / bullnose as spec", "tiling", "minor"),
        ("DAD-02", "No hollow wall tiles", "Tap every tile", "tiling", "major"),
        ("DAD-03", "Joints aligned with floor joints, uniform, grout / epoxy filled", "Visual", "tiling", "minor"),
        ("DAD-04", "Cut-outs around pipes, CP fittings and switches neat, no cracks", "Visual", "tiling", "minor"),
        ("DAD-05", "No cracked or chipped tiles; lippage within 1 mm", "Straight edge", "tiling", "minor"),
        ("DAD-06", "External corners with trims or mitred edges, straight", "Visual", "tiling", "minor"),
    ]),
    "SAN": ("Sanitary ware", [
        ("SAN-01", "WC of approved make, firmly fixed, level, no rocking; seat cover fitted", "Push test; spirit level", "plumbing", "major"),
        ("SAN-02", "Flush works, cistern refills and stops; both dual-flush buttons work", "Flush 3 times", "plumbing", "major"),
        ("SAN-03", "WC joint to floor / wall sealed; no leak on flush", "Tissue test at base after flushing", "plumbing", "major"),
        ("SAN-04", "Wash basin level and firmly fixed; counter / pedestal stable", "Push test", "plumbing", "minor"),
        ("SAN-05", "Basin waste, bottle trap and overflow work; no leak underneath", "Fill basin and release", "plumbing", "major"),
        ("SAN-06", "No chips, cracks or crazing on ceramic ware", "Visual, torch", "plumbing", "major"),
        ("SAN-07", "Health faucet, towel rail, robe hook, soap dish, paper holder, mirror fitted as spec", "Check against accessories list", "plumbing", "minor"),
        ("SAN-08", "Silicone around basin and counter neat and continuous", "Visual", "plumbing", "minor"),
    ]),
    "CPF": ("CP fittings & water supply", [
        ("CPF-01", "Hot and cold water at every outlet; hot on left", "Run every outlet", "plumbing", "major"),
        ("CPF-02", "Diverter, shower and spout operate; no drip after closing", "Operate each", "plumbing", "minor"),
        ("CPF-03", "Flow and pressure adequate", "Check at the highest outlet; compare top floors", "plumbing", "major"),
        ("CPF-04", "Concealed stop-cocks accessible, working and identified", "Operate each", "plumbing", "minor"),
        ("CPF-05", "Geyser point (socket + inlet / outlet) at correct height; geyser (if supplied) tested", "Visual; run hot water", "plumbing", "major"),
        ("CPF-06", "Wall flanges flush on all concealed outlets", "Visual", "plumbing", "minor"),
        ("CPF-07", "No leak at any joint after running all outlets for 5 min", "Check below basin, behind WC, in shaft", "plumbing", "major"),
        ("CPF-08", "Chrome finish free of scratches, rust or pitting", "Visual", "plumbing", "minor"),
    ]),
    "EXH": ("Ventilation", [
        ("EXH-01", "Exhaust fan point / fan works; cowl or louvre fitted outside", "Switch on", "electrical", "minor"),
        ("EXH-02", "Ventilator frame, louvres and glass intact and operable", "Operate", "fenestration", "minor"),
        ("EXH-03", "False ceiling access panel (if any) for plumbing / geyser", "Open panel", "plaster", "minor"),
    ]),
    "KIT": ("Kitchen", [
        ("KIT-01", "Platform level, firmly supported, height as spec, front edge moulded and polished", "Spirit level; typically 820-850 mm", "tiling", "minor"),
        ("KIT-02", "Platform joints epoxy filled; no cracks in stone; backsplash joint sealed", "Visual", "tiling", "minor"),
        ("KIT-03", "Sink fitted level and sealed; drains fast; no leak below", "Fill and release sink", "plumbing", "major"),
        ("KIT-04", "Sink tap / mixer works, aerator fitted", "Operate", "plumbing", "minor"),
        ("KIT-05", "Dado above platform to spec height; joints aligned", "Measure", "tiling", "minor"),
        ("KIT-06", "Appliance points (chimney, microwave, fridge, RO, dishwasher) at correct location and rating", "Compare with layout", "electrical", "minor"),
        ("KIT-07", "Chimney / exhaust core cut with cowl to outside", "Visual", "hvac", "minor"),
        ("KIT-08", "PNG gas pipe, isolation valve and meter point; leak test certificate", "Certificate from gas agency", "plumbing", "critical"),
        ("KIT-09", "RO / purifier inlet and drain point provided", "Visual", "plumbing", "minor"),
        ("KIT-10", "Modular kitchen (if in scope): shutters aligned, hinges and channels work, no swelling", "Operate each", "carpentry", "minor"),
    ]),
    "UTL": ("Utility", [
        ("UTL-01", "Washing machine inlet tap and drain point; socket at safe height", "Visual; socket clear of splash zone", "plumbing", "minor"),
        ("UTL-02", "Floor slopes to drain; no ponding", "Bucket test", "tiling", "major"),
        ("UTL-03", "Utility sink / tap works (if in scope)", "Operate", "plumbing", "minor"),
        ("UTL-04", "No dampness on walls or ceiling below", "Check flat below", "waterproofing", "major"),
    ]),
    "BAL": ("Balcony", [
        ("BAL-01", "Railing height as per spec / bye-laws from finished floor; rigid, no shake", "Measure; push hard at mid-span", "fabrication", "critical"),
        ("BAL-02", "Baluster gap within 100 mm; no climbable horizontal members", "Measure", "fabrication", "critical"),
        ("BAL-03", "Glass railing (if any): toughened laminated glass, clamps tight, edges polished", "Check stamp and fixings", "glazing", "critical"),
        ("BAL-04", "Railing welds ground, finish free of rust; anchors grouted and sealed", "Visual", "fabrication", "minor"),
        ("BAL-05", "Floor slopes away from the flat to outlet; no ponding", "Bucket test", "tiling", "major"),
        ("BAL-06", "Rainwater outlet with grating, connected and flowing", "Pour water", "plumbing", "major"),
        ("BAL-07", "Level drop / upstand at balcony door stops water entering the flat", "Visual; water test", "civil", "major"),
        ("BAL-08", "External paint on parapet and walls uniform; no cracks or seepage", "Visual", "paint", "minor"),
        ("BAL-09", "Drip groove under slab edge continuous", "Visual", "plaster", "minor"),
        ("BAL-10", "Light point and weatherproof socket as per layout", "Test", "electrical", "minor"),
    ]),
    "UNT": ("Whole flat / services", [
        ("UNT-01", "Room dimensions spot-checked against sale drawing", "Laser measure main rooms", "civil", "major"),
        ("UNT-02", "Floor-to-ceiling height as per drawing", "Laser measure", "civil", "minor"),
        ("UNT-03", "No cracks in beams, columns or slabs; no exposed steel or honeycombing", "Report any to structural consultant", "civil", "critical"),
        ("UNT-04", "DB: MCB ratings as per schedule; RCCB trips on test button and socket tester", "Press RCCB test; 30 mA tester", "electrical", "critical"),
        ("UNT-05", "DB circuits labelled; cover and blanks fitted; no exposed live parts", "Visual", "electrical", "major"),
        ("UNT-06", "Insulation resistance and earth continuity test record for this flat", "IR test record per spec (typically 1 MΩ or more)", "electrical", "major"),
        ("UNT-07", "Electricity meter installed, sealed, mapped to this flat; reading noted", "Switch off flat main and confirm meter stops", "electrical", "major"),
        ("UNT-08", "DG backup circuits work on changeover", "Coordinate DG test", "electrical", "major"),
        ("UNT-09", "Internal water line hydro-test record; no pressure drop", "Test record", "plumbing", "major"),
        ("UNT-10", "Water meter (if any) installed and mapped; reading noted", "Visual", "plumbing", "minor"),
        ("UNT-11", "No sewer smell; all traps charged with water", "Walk through with doors closed", "plumbing", "major"),
        ("UNT-12", "Plumbing shaft access door fitted; no leak in shaft", "Open and inspect", "plumbing", "major"),
        ("UNT-13", "Sprinklers / smoke detectors as per fire drawing; caps removed", "Compare with fire NOC drawings", "fire", "critical"),
        ("UNT-14", "Intercom handset works; extension number noted", "Test call", "electrical", "minor"),
        ("UNT-15", "Fittings of approved make (random check of tiles, CP, sanitary, switches, locks)", "Compare with spec sheet", "civil", "minor"),
        ("UNT-16", "Anti-termite / pest control record available", "Record", "civil", "minor"),
        ("UNT-17", "Deep cleaning done; debris, packaging and stickers removed", "Visual", "housekeeping", "minor"),
        ("UNT-18", "Lobby in front of flat: finishes, lighting and fire door OK", "Log common-area issues separately", "civil", "minor"),
    ]),
}

# Room kinds -> which element groups apply
ROOM_KINDS = {
    "foyer": ("Foyer / Entrance", ["CEIL", "WALL", "FLR", "SKT", "DRM", "ELC", "FOY"]),
    "living": ("Living / Dining", ["CEIL", "WALL", "FLR", "SKT", "WIN", "ELC", "AC"]),
    "bedroom": ("Bedroom", ["CEIL", "WALL", "FLR", "SKT", "DRI", "WIN", "ELC", "AC", "BR"]),
    "kitchen": ("Kitchen", ["CEIL", "WALL", "FLR", "SKT", "WIN", "ELC", "KIT"]),
    "toilet": ("Toilet", ["CEIL", "DRI", "WET", "DAD", "SAN", "CPF", "EXH", "ELC"]),
    "utility": ("Utility", ["CEIL", "FLR", "DAD", "UTL", "ELC"]),
    "balcony": ("Balcony", ["CEIL", "FLR", "WIN", "BAL"]),
    "passage": ("Passage / Lobby", ["CEIL", "WALL", "FLR", "SKT", "ELC"]),
    "flat": ("Whole flat", ["UNT"]),
}

FLAT_TYPES = {
    "2BHK": [
        ("foyer", "Foyer", "foyer"), ("living", "Living / Dining", "living"), ("kitchen", "Kitchen", "kitchen"),
        ("utility", "Utility", "utility"), ("passage", "Passage", "passage"),
        ("bed1", "Master Bedroom", "bedroom"), ("bed2", "Bedroom 2", "bedroom"),
        ("toi1", "Master Toilet", "toilet"), ("toi2", "Common Toilet", "toilet"),
        ("bal1", "Living Balcony", "balcony"), ("bal2", "Bedroom Balcony", "balcony"),
        ("flat", "Whole flat & services", "flat"),
    ],
    "3BHK": [
        ("foyer", "Foyer", "foyer"), ("living", "Living / Dining", "living"), ("kitchen", "Kitchen", "kitchen"),
        ("utility", "Utility", "utility"), ("passage", "Passage", "passage"),
        ("bed1", "Master Bedroom", "bedroom"), ("bed2", "Bedroom 2", "bedroom"), ("bed3", "Bedroom 3", "bedroom"),
        ("toi1", "Master Toilet", "toilet"), ("toi2", "Toilet 2", "toilet"), ("toi3", "Toilet 3", "toilet"),
        ("bal1", "Living Balcony", "balcony"), ("bal2", "Bedroom Balcony", "balcony"),
        ("flat", "Whole flat & services", "flat"),
    ],
}

HANDOVER = {
    "meters": [("elec", "Electricity meter (kWh)"), ("dg", "DG / prepaid meter"), ("water", "Water meter"), ("gas", "PNG gas meter")],
    "keys": [("main", "Main door"), ("bedroom", "Bedroom doors"), ("toilet", "Toilet doors"), ("balcony", "Balcony / window locks"),
             ("letterbox", "Letter box"), ("db", "DB / meter box"), ("card", "Access cards / RFID tags")],
    "docs": [("possession", "Possession letter"), ("jir", "Joint inspection report (snag list) signed"),
             ("warranty_cp", "Warranty cards: CP and sanitary fittings"), ("warranty_win", "Warranty: windows and main door lock"),
             ("warranty_other", "Warranty: modular kitchen / appliances (if any)"), ("asbuilt", "As-built electrical and plumbing layouts"),
             ("manual", "Owner's manual (incl. no drilling / core cutting in RCC, waterproofing care)"),
             ("maint", "Maintenance agreement and RWA forms"), ("parking", "Parking allotment letter")],
    "demo": [("rccb", "DB, MCB and RCCB reset shown"), ("valves", "Water isolation valves shown"), ("gasvalve", "Gas isolation valve shown"),
             ("intercom", "Intercom and video door phone shown"), ("fire", "Smoke detector, sprinkler and escape route explained"),
             ("windows", "Window locks and mesh shown")],
    "gate": [("oc", "Occupancy certificate received / possession offered"), ("crm", "CRM confirms dues cleared")],
}


def build():
    items = []
    for gcode, (glabel, rows) in GROUPS.items():
        for (iid, t, c, team, sev) in rows:
            items.append({"id": iid, "g": gcode, "t": t, "c": c, "team": team, "sev": sev})
    return {
        "teams": [{"id": a, "name": b} for a, b in TEAMS],
        "severity": [{"id": a, "name": b, "desc": c} for a, b, c in SEVERITY],
        "groups": {g: v[0] for g, v in GROUPS.items()},
        "items": items,
        "kinds": {k: {"label": v[0], "groups": v[1]} for k, v in ROOM_KINDS.items()},
        "flatTypes": {ft: [{"key": a, "label": b, "kind": c} for a, b, c in rooms] for ft, rooms in FLAT_TYPES.items()},
        "handover": {k: [{"id": a, "label": b} for a, b in v] for k, v in HANDOVER.items()},
    }


if __name__ == "__main__":
    d = build()
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    js = os.path.join(here, "..", "js")
    txt = json.dumps(d, separators=(",", ":"))
    open(os.path.join(js, "checklist.json"), "w").write(txt)
    open(os.path.join(js, "checklist.js"), "w").write("// Generated by tools/checklist.py. Edit that file, then run: python3 tools/checklist.py\nconst CL = " + txt + ";\n")
    per = {}
    for ft, rooms in d["flatTypes"].items():
        n = 0
        for r in rooms:
            for g in d["kinds"][r["kind"]]["groups"]:
                n += sum(1 for i in d["items"] if i["g"] == g)
        per[ft] = n
    print(len(d["items"]), "unique items; checks per flat:", per)
