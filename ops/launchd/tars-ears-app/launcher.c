// TARS Ears launcher — the CFBundleExecutable of TarsEars.app.
//
// Why a compiled binary and not a shell script or a bare `exec node`:
// macOS attributes microphone (TCC) access to the "responsible process", which it
// resolves from the process image and its enclosing .app bundle. If this launcher
// exec-replaced itself with node, the process image would become /opt/homebrew/bin/node
// (OUTSIDE the bundle) and macOS would re-attribute the mic to node — losing the grant.
// A shell script has the same problem: after exec the image is /bin/bash.
//
// So instead we stay alive as a real Mach-O living INSIDE the bundle and fork node as a
// child. node (and the whisper-stream it spawns) inherit our responsible process = the
// signed TarsEars.app bundle. Grant the mic to the app once and the whole chain gets audio.
#include <unistd.h>
#include <spawn.h>
#include <sys/wait.h>
#include <signal.h>

// Which node script this bundle launches — overridden at compile time by build.sh
// (-DTARS_NODE=..., -DTARS_SCRIPT=...) so one launcher source builds every bundle
// (TarsEars.app → the ears/mic, TarsHands.app → the inject/Accessibility service).
#ifndef TARS_NODE
#define TARS_NODE "/opt/homebrew/bin/node"
#endif
#ifndef TARS_SCRIPT
#define TARS_SCRIPT "/ABSOLUTE/PATH/TO/tars/voice/tars-ears.mjs"
#endif

extern char **environ;

int main(void) {
    char *const args[] = { TARS_NODE, TARS_SCRIPT, NULL };
    pid_t pid;
    if (posix_spawn(&pid, args[0], NULL, NULL, args, environ) != 0) return 1;

    // Relay launchd's stop signals to the child, then reap it — so `launchctl bootout`
    // cleanly tears down node + whisper-stream instead of orphaning them.
    int status = 0;
    for (;;) {
        pid_t r = waitpid(pid, &status, 0);
        if (r == pid) break;
        if (r < 0) break;
    }
    return 0;
}
