# Rodwise: the C core is built twice, natively for the tests and as WebAssembly for the site.
CC        ?= cc
CFLAGS    := -std=c17 -O2 -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wdouble-promotion -Werror
SAN       := -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer
CORE      := core/maths.c core/scene.c core/sphere.c core/strike.c core/plan.c
WASMFLAGS := --target=wasm32 -O3 -nostdlib -ffreestanding -std=c17 \
             -Wall -Wextra -Wpedantic -Wshadow -Werror \
             -Wl,--no-entry -Wl,--initial-memory=33554432 -Wl,--max-memory=33554432 \
             -Wl,-z,stack-size=1048576 -Wl,--strip-all

.PHONY: all wasm test-core bench lint clean

all: wasm

wasm: site/assets/rodwise.wasm

site/assets/rodwise.wasm: $(CORE) core/wasm.c core/rodwise.h
	@mkdir -p site/assets
	clang $(WASMFLAGS) -o $@ $(CORE) core/wasm.c

build/test_core: $(CORE) tests/core/test_core.c core/rodwise.h
	@mkdir -p build
	$(CC) -std=c17 -Wall -Wextra -Wpedantic -Wshadow -Werror $(SAN) -o $@ $(CORE) tests/core/test_core.c -lm

build/bench: $(CORE) tests/core/bench.c core/rodwise.h
	@mkdir -p build
	$(CC) -std=c17 -O2 -o $@ $(CORE) tests/core/bench.c -lm

test-core: build/test_core
	./build/test_core

bench: build/bench
	./build/bench

lint:
	$(CC) $(CFLAGS) -fsyntax-only $(CORE)
	clang-tidy $(CORE) --quiet -checks='bugprone-*,cert-*,clang-analyzer-*,-bugprone-easily-swappable-parameters,-cert-err33-c' -- -std=c17

clean:
	rm -rf build
