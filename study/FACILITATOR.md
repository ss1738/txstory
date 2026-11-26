# Facilitator script

Goal: observe, not teach. Read the script verbatim where marked "Say". Never
hint at an answer, at where to look, or at what a label means.

## Before the session (about 10 min)
1. Start TxStory in recorded mode with the captured recordings (see
   `study/README.md`, "Captured recordings") and open
   `http://127.0.0.1:8787/` once to confirm it loads.
2. Open `https://eth.blockscout.com` once to confirm it loads in this browser.
3. Open the participant's sheet `study/sessions/P0N.md`. It lists the condition and
   the exact link order.
4. Open `study/results/P0N.csv`, created by `make_session_sheets.py` with one row
   per question already filled in. The `study/results/` folder is git-ignored.
   Note anything that goes wrong in `study/results/issues.csv`, copied from
   `issues-template.csv`.
5. Use a fresh browser window and close other tabs.

## Start
Say: "Thanks for helping. We're testing two ways of reading blockchain
transactions, not testing you. There are no trick questions. I'll give you a link
and read a question; answer from what you see on the page, out loud. You can
explore the page freely, but please don't use other websites or AI tools. I can't
help with the questions, but you can always say 'I don't know' or 'skip'. We
record your answers, how long they take, and short notes. We record no names, no wallet
details, no screen or audio recording. You can stop at any time. Is that OK?"

Record their self-rated blockchain familiarity: "From 1 (never used one) to 5
(I read explorers often), how familiar are you with blockchain explorers?"

## Each task
1. Open the next link from the sheet. Say: "Here's the next transaction."
2. Read the question exactly as written in `TASKS.md` and start the stopwatch.
3. Stop the stopwatch when they give a final answer, or after 4 minutes with no
   progress. Say "You can move on" and record `no-answer`.
4. Ask: "How confident are you, from 1 to 5?"
5. Write the answer verbatim, as near as you can, in the CSV.

If asked "what does X mean?", say: "What do you think it means?" or "Please answer
from what you can see." Do not explain labels, badges or terms.

If something technical fails (the page doesn't load), note `TECH` in comments,
reload once, and continue. Don't count the lost time.

## Between blocks
Say: "Now the same kinds of questions, using a different site." (No commentary on
the first site.)

## End (about 3 min)
Ask, and record verbatim:
1. "Which of the two would you rather use next time, and why?"
2. "Was anything confusing or misleading on either site?"
3. "Did either site make you unsure whether information was complete?"

## After the session
Score answers with `ANSWER_KEY.md` into the CSV columns `score` and `code`. Score
blind to the interface where possible, for example by having a second person score
from the answer text alone. Keep the raw answer text; never overwrite it.
