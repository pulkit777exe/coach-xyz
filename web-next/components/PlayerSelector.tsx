'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Player } from '@/types'

interface PlayerSelectorProps {
  players: Player[]
  onSelect: (playerIndex: number) => void
}

function PlayerImage({ player }: { player: Player }) {
  const [imgError, setImgError] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)

  const hasBase64 = !!player.crop_base64 && player.crop_base64.trim().length > 0

  if (!hasBase64 || imgError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-(--cream-40)">
        <svg className="w-12 h-12 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
        <span className="text-xs">No preview</span>
      </div>
    )
  }

  return (
    <>
      {!imgLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--cream-20) border-t-transparent" />
        </div>
      )}
      <img
        src={`data:image/jpeg;base64,${player.crop_base64.trim()}`}
        alt={`Subject ${player.player_index}`}
        className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setImgLoaded(true)}
        onError={(e) => {
          console.error(`[PlayerImage] Failed to load crop for player ${player.player_index}:`, {
            base64Length: player.crop_base64?.length,
            base64Prefix: player.crop_base64?.substring(0, 40),
            error: e,
          })
          setImgError(true)
        }}
      />
    </>
  )
}

export default function PlayerSelector({ players, onSelect }: PlayerSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  return (
    <>
      <div className="min-h-screen bg-transparent p-6 flex flex-col items-center relative z-10 pt-24 pb-20">
        <div className="max-w-5xl w-full">
          <div className="text-center mb-12 animate-[fadeInDown_0.8s_ease-out]">
              <h1 className="font-serif text-4xl sm:text-5xl text-(--fg) mb-4 leading-tight">
                Who do you want to <span className="text-(--fg)">analyze?</span>
              </h1>
            <p className="text-lg text-(--cream-40) max-w-2xl mx-auto">
              Our vision models detected <span className="text-(--fg) font-bold">{players.length}</span> potential subjects. Select the primary athlete to continue the pipeline.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mt-8 mb-16 px-4 justify-items-center mx-auto w-fit max-w-full">
            {players.map((player, i) => {
              const isSelected = selectedIndex === player.player_index
              return (
                <div
                  key={player.player_index}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select Subject ${player.player_index}, confidence ${(player.confidence * 100).toFixed(0)}%`}
                  aria-pressed={isSelected}
                  className={`animate-[fadeInUp_0.45s_ease-out_both] cursor-pointer group relative rounded-none p-[2px] overflow-hidden transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--fg) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg) ${isSelected ? 'bg-(--fg)' : 'bg-(--cream-05) hover:bg-(--cream-20)'}`}
                  style={{ animationDelay: `${0.2 + i * 0.1}s` }}
                  onClick={() => setSelectedIndex(player.player_index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedIndex(player.player_index)
                    }
                  }}
                >
                  <Card className={`relative h-full w-full bg-(--bg) border-none rounded-none overflow-hidden transition-all ${isSelected ? 'bg-(--bg)' : ''}`}>
                    <CardContent className="p-5 flex flex-col items-center text-center">
                      <div className="relative w-full aspect-square rounded-none overflow-hidden mb-5 bg-(--cream-05) border border-(--cream-10) shadow-inner">
                        <PlayerImage player={player} />
                        {isSelected && (
                          <div className="absolute inset-0 bg-(--cream-10) mix-blend-overlay"></div>
                        )}
                        {isSelected && (
                          <div className="absolute top-3 right-3 w-8 h-8 bg-(--fg) rounded-full flex items-center justify-center text-(--bg)">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                          </div>
                        )}
                      </div>

                      <h3 className={`font-serif text-xl font-bold mb-3 transition-colors ${isSelected ? 'text-(--fg)' : 'text-(--cream-40) group-hover:text-(--fg)'}`}>
                        Subject {player.player_index}
                      </h3>

                      <div className="w-full flex justify-center">
                        <Badge variant="outline" className={`font-mono text-[0.65rem] uppercase tracking-widest px-3 py-1 border transition-colors ${
                          player.confidence >= 0.8 ? 'border-(--cream-20) text-(--fg) bg-(--cream-05)' :
                          player.confidence >= 0.6 ? 'border-amber-500/30 text-amber-300 bg-amber-500/10' :
                          'border-rose-500/30 text-rose-300 bg-rose-500/10'
                        }`}>
                          Confidence: {(player.confidence * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )
            })}
          </div>

              <div className="animate-[fadeInUp_0.45s_ease-out_0.6s_both] max-w-sm mx-auto">
                <Button
                  className={`w-full h-16 rounded-none text-base font-bold transition-colors duration-200 ${
                    selectedIndex !== null
                      ? 'button-accent'
                  : 'bg-(--cream-05) border border-(--cream-10) text-(--cream-40) cursor-not-allowed shadow-none'
              }`}
              size="lg"
              disabled={selectedIndex === null}
              onClick={() => selectedIndex !== null && onSelect(selectedIndex)}
            >
              {selectedIndex !== null ? (
                <span className="flex items-center gap-2 text-(--bg)">
                  Confirm Selection
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </span>
              ) : 'Select a subject to continue'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
