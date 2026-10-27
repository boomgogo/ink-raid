
# Issues

## In multiplayer

1. my friends' weapons look totally different from the weapons I'm holding
    - can you make them look the same?
2. all players are dropped at the exact same location, which looks overlapping at the start
    - can you separate them slightly?

## on mobile phone

2. It's not possible to pause, here's the recommended fix:
    - A pause button in the touch layer: a fourth small button at the left end of the top row, beside LOAD/NEXT/WRAP, the same size, so touch.mjs's 44 px and overlap checks cover it.
    - Pause on app switch: pause when the page is hidden in a run, so coming back to the game lands on the pause screen rather than straight into the fight.
    - Tests: touch.mjs and coop.mjs would tap the button instead of calling pause(), so the tests take the same path a player does.
3. Right now, anywhere I touch on the right side of the screen, it'll shoot
    - can you make it so that only the two "ink" buttons shoot?



# Features

1. Create some new 3D models for all weapons and make them look more fancy
2. Allow the grenade to be thrown a little further away and make better explosion effect



# Older Items

These are older items so first check to see if they are still issues and improvements that we need to fix / make

- From summary.md:
  - When the last figure is a nest sniper and no nest can see anyone, the wave stalls.
  - Enemy hit volumes are bigger than their drawn limbs.
- From next_3.md:
  - The lineup in figures.mjs faces away from the camera.
  - A friend's footsteps and jetpack make no sound.
