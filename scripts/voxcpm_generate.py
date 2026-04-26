#!/usr/bin/env python3
"""Generate a cloned voice note with VoxCPM.

This script intentionally uses the VoxCPM generate signature with
prompt_wav_path + prompt_text (+ reference_wav_path) to preserve
high-fidelity cloning behavior.
"""

import argparse
from pathlib import Path

import soundfile as sf
from voxcpm import VoxCPM


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Generate voice note audio with VoxCPM")
  parser.add_argument("--hf-model-id", required=True, help="Hugging Face model id, e.g. openbmb/VoxCPM-0.5B")
  parser.add_argument("--text", required=True, help="Target speech text")
  parser.add_argument("--prompt-wav-path", required=True, help="Path to prompt/reference speaker wav")
  parser.add_argument("--prompt-text", required=True, help="Transcript of the prompt wav")
  parser.add_argument("--reference-wav-path", help="Optional reference wav for stronger similarity")
  parser.add_argument("--output", required=True, help="Output wav path")
  return parser.parse_args()


def main() -> int:
  args = parse_args()

  model = VoxCPM.from_pretrained(args.hf_model_id)

  prompt_wav_path = str(Path(args.prompt_wav_path).expanduser())
  output_path = Path(args.output).expanduser()
  output_path.parent.mkdir(parents=True, exist_ok=True)
  reference_wav_path = args.reference_wav_path or prompt_wav_path

  wav = model.generate(
    text=args.text,
    prompt_wav_path=prompt_wav_path,
    prompt_text=args.prompt_text,
    reference_wav_path=str(Path(reference_wav_path).expanduser()),
  )

  sf.write(str(output_path), wav, model.tts_model.sample_rate)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
