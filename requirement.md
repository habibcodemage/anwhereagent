The brief
Codebase Investigator
The task
Build a codebase investigator. A user pastes a public GitHub URL, asks questions about the code in plain English, and the agent investigates using tools and produces answers grounded in specific files and line ranges.

Requirements
Every answer ships with its own audit
For any non-trivial answer, the reviewer (a human) should see whether the answer is worth trusting, and why. That includes catching hallucinated citations, over-confident claims, suggested fixes that would break something else, and reasoning with a hole in it.

One hard rule: self-scoring in the same prompt as the answer doesn't count. "I rate my confidence 8/10" from the same call that produced the answer is noise, not a signal. The audit has to come from somewhere else — a different model, a different prompt, a programmatic check, a separate context. Your call how.

The conversation has to stay sharp over many turns
Realistic investigation is 8–15 turns of pushback: "look at X," "actually what about Y," "in your third answer you said Z — now you're contradicting it." The system has to stay coherent across that — not repeat itself, not lose earlier claims, not silently drop context.

Example questions
The mix matters. Some are retrieval, some are evaluation, some are opinion.

"How does auth work here, and what would you change about it?"
"This signup flow feels off — walk me through it and flag anything risky."
"Is there dead code? What's safe to delete?"
"Why is this function async? Does it need to be?"
"Suggest a better way to handle errors in the API layer."
"Walk me through what this service does. Skip the obvious."
Timing
One day. We're watching how you scope, what you cut, and what you keep.

Stack
Up to you.

