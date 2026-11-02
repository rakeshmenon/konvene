#!/bin/sh
# Makes tests/fixtures/voice.wav: synthetic speech from ffmpeg's flite voice (a computer reading text, no recording of
# a person). It stands in for a microphone in the smoke test, where noise reduction must keep speech.
# Needs an ffmpeg built with libflite. Run from the extension folder.
set -e
mkdir -p tests/fixtures
ffmpeg -v error -y -f lavfi -i "flite=voice=slt:text='Hello everyone, thanks for joining. Today we will go over the plan for the next release. First, the recorder keeps your voice clear. Second, the shared screen sound is added while you present. Finally, everything is saved on your own computer. Any questions before we start?'" -ar 16000 -ac 1 tests/fixtures/voice.wav
