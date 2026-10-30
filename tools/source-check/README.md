# Source check

Automatic check of Health cards against their source pages. Every card says that a named person or organisation said something in a named document. This tool fetches that document and tests the claim, without a human in the loop and with repeatable results.

Input: the cards in [`cards/health/`](../../cards/health/README.md). Output: one JSON line per card with the verdict, the rule results, the model answer and the hashes needed to reproduce the run.

## What it checks

1. **Fetch.** One request per URL, a browser-like user agent, a 1.5 s pause, up to three attempts on connection errors and 5xx. Raw response, extracted text, HTTP status, fetch time and text hash are stored in the cache folder. PDFs are converted to text. Pages behind a bot challenge count as not readable.
2. **Fixed rules, no model.**
   - (a) Source reachable: HTTP 200 and at least 200 characters of readable text, no bot challenge.
   - (b) Quotation: both sides are normalised (Unicode NFKC, lower case, collapsed white space, unified quotation marks and dashes, hyphenation removed). Passes if the quotation occurs verbatim or the fuzzy similarity (rapidfuzz `partial_ratio`) is at least 90 of 100. A quotation with an ellipsis is split into segments and every segment of at least 20 characters must pass.
   - (c) Numbers: every number with a unit on the card (µg, mg, g, IU, %, ng/ml, nmol/l, mmol/l, mg/dl, kcal, ml, l, mg/kg, g/kg) must occur in the source text. Spellings count as equal: µg = μg = mcg, IU = UI, 0,2 = 0.2, 3000 = 3.000 = 3,000, ranges such as 15–30 mg. In tables, a number of two or more digits with the unit within 300 characters also counts.
   - (d) A card stays `evidenced` (PROVEN) only if (b) and (c) pass; otherwise it is at most `said` (SAID).
   - (e) Speaker: the speaker or organisation named on the card must occur in the source text (full name, name without brackets, bracket content, abbreviation, or the surname for persons; accents are ignored).
3. **Model verdict.** A local model through Ollama, never a cloud service. Temperature 0, seed 42, `top_k` 1, fixed context and thread options, a fixed JSON answer schema, the prompt in [`prompt_v4.txt`](prompt_v4.txt) (its SHA-256 is written into every result and every card). The model sees only the card, the first 400 characters of the document and an excerpt of about 3000 characters around the best match. It returns `PASS`, `FAIL` or `UNCLEAR` for the rendering (translation, upper limit versus recommendation, population) and for the attribution.
4. **Overall verdict.**
   - `RAUS` (remove): source not reachable, blocked or without text; neither quotation nor number found; speaker not in the source text (e); model `FAIL`.
   - `HERABSTUFEN` (downgrade): an `evidenced` card for which (b) or (c) fails, or the model says `UNCLEAR`.
   - `OK`: everything else. A `said` card with a number that was not found gets a note to take the number off the card.

## Result of 2026-10-29

Model `qwen35-fallback:latest` (digest `eeeb0e51a873c307a0d36f83adf24961fc91ff85514b825d9456a81ee8a3c4e8`), Ollama 0.32.7, prompt SHA-256 `b786dc45e54e5a235b1b7cedc599b7ca23f78562b24d53965f1b69bd4506c0b8`.

| Run                                      | Cards |  OK | Downgrade | Remove |
| ---------------------------------------- | ----: | --: | --------: | -----: |
| First board set                          |   326 | 181 |        80 |     65 |
| Follow-up research (replacement sources) |    85 |  55 |        17 |     13 |

Cards that failed were removed, cards that were downgraded are shown as `said`, and numbers that were not found on the source were taken off the card. The published set is [`cards/health/`](../../cards/health/README.md): 333 cards across 47 nutrients, 131 `evidenced` and 202 `said`. Each card carries its own `check` block.

- **Repeatability.** 20 random cards were checked a second time with the stored source texts: 20 of 20 identical, down to the model's raw answer, character for character. Two causes of earlier differences were removed: the model's prompt cache (a fixed warm-up call) and a changing split of the model between GPU and CPU (fixed `num_gpu`, `num_batch`, `num_thread`).
- **Negative control.** 20 random cards, each checked three times: unchanged, with a deliberately wrong number, and with a wrong speaker. Unchanged cards: model `PASS` 20 of 20, overall `OK` 16 of 20. Wrong number: no longer `OK` in 15 of 20 (14 of 14 `evidenced` cards). Wrong speaker: no longer `OK` in 18 of 20 (12 of 14 `evidenced` cards).

## Limits

- **The model alone is too lenient.** With a wrong number the model said `FAIL` in only 5 of 20 cases, with a wrong speaker in only 1 of 20. A small local model (9 billion parameters) is not a reliable checker on its own. The fixed rules (b), (c) and (e) carry the check; the model is an additional test of meaning and removes a card only on `FAIL`. Some `FAIL` reasons contradict their own verdict, so a few good cards may have been removed.
- **`said` cards are the floor.** A wrong number on a `said` card cannot lower the verdict below `OK`; it only gets a note.
- **Rule (c) is literal.** Converted values (for example 1 µg RE = 3.33 IU) and self-calculated figures are reported as not found.
- **Bot protection.** Sources behind a challenge cannot be read by a script and are removed or replaced.
- **It checks the page, not the science.** The tool tests that the source says what the card says. It does not judge whether the source is right.

## Usage

Python 3.10 or newer and a local [Ollama](https://ollama.com) with the model pulled.

```sh
pip install -r requirements.txt
python pruefe_karten.py --karten ../../cards/health --stufe alles --out ergebnis.jsonl
python auswerten.py                      # summary in zusammenfassung.json
```

Options: `--stufe abruf|pruefen|alles` (fetch only, check only, both), `--ids b-114,b-691`, `--model NAME` (default `qwen35-fallback:latest`, or env `RR_MODEL`), `--ollama-url URL` (default `http://127.0.0.1:11434`, or env `RR_OLLAMA`), `--cache DIR` (default `./cache`, or env `RR_CACHE`), `--prompt FILE`, `--ohne-ki` (rules only), `--erneut` (refetch failures), `--wiederholung 20 --startwert 7` (repeatability sample), `--karten` also accepts a JSON file in the board export format.

`python kontrolle.py ../../cards/health` runs the negative control against an existing `ergebnis.jsonl`. Names of result and prompt fields are German for historical reasons.
