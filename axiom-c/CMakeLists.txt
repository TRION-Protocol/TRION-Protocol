cmake_minimum_required(VERSION 3.20)
project(axiom-c C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Optimization flags for embedded targets
if(EMBEDDED)
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Os -ffunction-sections -fdata-sections -fno-exceptions")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--gc-sections")
endif()

# Library target
add_library(axiom_minimal STATIC
    src/axiom_minimal.c
    src/blake3_minimal.c
)

target_include_directories(axiom_minimal PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# Disable standard library for embedded targets
if(NO_STD)
    target_compile_options(axiom_minimal PRIVATE
        -nostdlib -nostdinc -fno-builtin
    )
endif()

# Host test build (with standard library)
if(NOT EMBEDDED)
    add_executable(axiom_c_test
        src/axiom_minimal.c
        src/blake3_minimal.c
        tests/test_axiom_minimal.c
    )
    target_include_directories(axiom_c_test PRIVATE include)
    target_compile_options(axiom_c_test PRIVATE -Wall -Wextra -g)
endif()

# ESP32 port
if(ESP32)
    add_subdirectory(ports/esp32)
endif()

# ARM Cortex-M port
if(CORTEX_M)
    add_subdirectory(ports/cortex_m)
endif()
