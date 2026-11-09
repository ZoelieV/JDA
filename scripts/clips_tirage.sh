#!/usr/bin/env bash
# Clips web des animations de tirage (vœux de cosmétiques, cf.
# site/commun/tirage_cosmetique.js), à partir des enregistrements du jeu
# rangés dans site/DB/temp/remplacement emojis/ (pas versionnés) :
#   1280x720, UID (bas droite) et « Passer » (haut droite) floutés,
#   son remonté de 21,8 dB (enregistrements très bas) avec un limiteur,
#   transition.wav à la place des 0,75 premières secondes du son de
#   l'obtention (une fois par tirage).
# Sorties dans site/DB/videos/ :
#   voeu_5_capture.mp4         vœu simple 5★ avec capture de radiance + obtention 5★
#   dix_4/5/5_capture.mp4      dix vœux, jusqu'au premier écran d'obtention
#   obtention_3/4/5.mp4        écran d'obtention seul (objets suivants d'un dix vœux)
#   obtention_3/4/5_t.mp4      le même, avec la transition (premier objet)
#   obtention_2(_t).mp4        2★ (cosmétique commun) : image du 3★, son du
#                              tirage_boss_2.mp4 (sans le 3e tintement)
# Les vœux simples 3★/4★/5★ réutilisent tirage_boss_3/4/5.mp4 (même montage).
set -euo pipefail
cd "$(dirname "$0")/../site"
SRC="DB/temp/remplacement emojis"
OUT="DB/videos"
GAIN="21.8dB"
# Flou de l'UID et du bouton « Passer », après la mise à 1280x720.
FLOU="scale=1280:720:flags=lanczos,fps=60,split=3[b][u0][p0];[u0]crop=165:28:1092:692,boxblur=luma_radius=10:luma_power=2:chroma_radius=6:chroma_power=2[u];[p0]crop=115:38:1122:14,boxblur=luma_radius=10:luma_power=2:chroma_radius=6:chroma_power=2[p];[b][u]overlay=1092:692[b2];[b2][p]overlay=1122:14"
ENC=(-c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -ar 48000 -movflags +faststart)
SON="volume=${GAIN},alimiter=limit=0.95"

# Vœu + obtention (transition sur l'obtention).
voeu_obtention() { # $1 vœu, $2 obtention, $3 sortie
  ffmpeg -v error -y -i "$1" -i "$2" -i "$SRC/transition.wav" -filter_complex "
    [0:v]setpts=PTS-STARTPTS[v0];[1:v]setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0,${FLOU}[v];
    [1:a]atrim=start=0.75,asetpts=PTS-STARTPTS[a1r];[2:a]aformat=sample_rates=48000:channel_layouts=stereo[t];
    [0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];[t][a1r]concat=n=2:v=0:a=1[a1];
    [a0][a1]concat=n=2:v=0:a=1,${SON}[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$3"
}

# Clip seul (dix vœux, obtention sans transition).
seul() { # $1 entrée, $2 sortie
  ffmpeg -v error -y -i "$1" -filter_complex "[0:v]${FLOU}[v];[0:a]aformat=sample_rates=48000:channel_layouts=stereo,${SON}[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$2"
}

# Obtention avec la transition au début.
obtention_t() { # $1 obtention, $2 sortie
  ffmpeg -v error -y -i "$1" -i "$SRC/transition.wav" -filter_complex "
    [0:v]${FLOU}[v];[0:a]atrim=start=0.75,asetpts=PTS-STARTPTS[r];[1:a]aformat=sample_rates=48000:channel_layouts=stereo[t];
    [t][r]concat=n=2:v=0:a=1,${SON}[a]" -map "[v]" -map "[a]" "${ENC[@]}" "$2"
}

voeu_obtention "$SRC/single 5* capture.mp4" "$SRC/obtention 5*.mp4" "$OUT/voeu_5_capture.mp4"
seul "$SRC/ten pull 4*.mp4" "$OUT/dix_4.mp4"
seul "$SRC/ten pull 5*.mp4" "$OUT/dix_5.mp4"
seul "$SRC/ten pull 5* capture.mp4" "$OUT/dix_5_capture.mp4"
for n in 3 4 5; do
  seul "$SRC/obtention ${n}*.mp4" "$OUT/obtention_${n}.mp4"
  obtention_t "$SRC/obtention ${n}*.mp4" "$OUT/obtention_${n}_t.mp4"
done
# 2★ : son de tirage_boss_2.mp4 (obtention à partir de 5,933 s, transition comprise).
# tirage_boss_2.mp4 (pas fait ici) a déjà son 3e tintement coupé net : fondu
# de 60 ms à partir de 8,108 s, puis silence, fait une fois avec
#   ffmpeg -i ancien.mp4 -af "afade=t=out:st=8.108:d=0.06" -c:v copy -c:a aac -b:a 128k -ar 48000 tirage_boss_2.mp4
# (à refaire s'il est réenregistré) ; les obtention_2 en héritent (fondu à 2,175 s).
ffmpeg -v error -y -i "$OUT/obtention_3_t.mp4" -i "$OUT/tirage_boss_2.mp4" -filter_complex "[1:a]atrim=start=5.933,asetpts=PTS-STARTPTS,apad[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "$OUT/obtention_2_t.mp4"
ffmpeg -v error -y -i "$OUT/obtention_3.mp4" -i "$OUT/tirage_boss_2.mp4" -filter_complex "[0:a]atrim=0:0.75,asetpts=PTS-STARTPTS[d];[1:a]atrim=start=6.683,asetpts=PTS-STARTPTS[f];[d][f]concat=n=2:v=0:a=1,apad[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "$OUT/obtention_2.mp4"
ls -la "$OUT"
