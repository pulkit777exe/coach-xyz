'use client'

import { useState, useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Player } from '@/types'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP)
}

interface PlayerSelectorProps {
  players: Player[]
  onSelect: (playerIndex: number) => void
}

export default function PlayerSelector({ players, onSelect }: PlayerSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.from('.gsap-header', {
      y: -30,
      opacity: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: 'power3.out'
    })

    gsap.from('.gsap-card', {
      y: 40,
      opacity: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: 'back.out(1.5)',
      delay: 0.3
    })

    gsap.from('.gsap-button', {
      y: 20,
      opacity: 0,
      duration: 0.6,
      ease: 'power2.out',
      delay: 0.8
    })
  }, { scope: containerRef })

  return (
    <div ref={containerRef} className="min-h-screen bg-transparent p-6 flex flex-col items-center relative z-10 pt-24 pb-20">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-[radial-gradient(ellipse,rgba(20,184,166,0.1),transparent_70%)]" />

      <div className="max-w-5xl w-full">
        <div className="text-center mb-12">
          <h1 className="gsap-header font-display text-[clamp(2rem,5vw,4rem)] font-bold text-white mb-4 leading-tight tracking-tight drop-shadow-lg">
            Who do you want to <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">analyze?</span>
          </h1>
          <p className="gsap-header text-lg text-zinc-400 max-w-2xl mx-auto">
            Our vision models detected <span className="text-white font-bold">{players.length}</span> potential subjects. Select the primary athlete to continue the pipeline.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mt-8 mb-16 px-4">
          {players.map((player) => {
            const isSelected = selectedIndex === player.player_index
            return (
              <div 
                key={player.player_index} 
                className={`gsap-card cursor-pointer group relative rounded-[2rem] p-[2px] overflow-hidden transition-all duration-300 ${isSelected ? 'scale-105 shadow-[0_0_30px_rgba(20,184,166,0.4)]' : 'hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]'}`}
                onClick={() => setSelectedIndex(player.player_index)}
              >
                {/* Animated Border gradient */}
                <div className={`absolute inset-0 transition-opacity duration-300 ${isSelected ? 'bg-gradient-to-br from-teal-400 to-cyan-600 opacity-100' : 'bg-white/10 opacity-100'}`}></div>
                <div className={`absolute inset-0 bg-gradient-to-br from-teal-400 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${isSelected ? 'hidden' : 'block'}`}></div>
                
                <Card className={`relative h-full w-full bg-zinc-950/90 backdrop-blur-3xl border-none rounded-[calc(2rem-2px)] overflow-hidden transition-all ${isSelected ? 'bg-zinc-950/70' : ''}`}>
                  <CardContent className="p-5 flex flex-col items-center text-center">
                    <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-5 bg-zinc-900 border border-white/5 shadow-inner">
                      <img
                        src={`data:image/jpeg;base64,${player.crop_base64}`}
                        alt={`Subject ${player.player_index}`}
                        className={`w-full h-full object-cover transition-transform duration-700 ease-in-out ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`}
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-teal-500/20 mix-blend-overlay"></div>
                      )}
                      {isSelected && (
                        <div className="absolute top-3 right-3 w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(20,184,166,0.8)] text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                        </div>
                      )}
                    </div>
                    
                    <h3 className={`font-display text-xl font-bold mb-3 transition-colors ${isSelected ? 'text-teal-400' : 'text-zinc-200 group-hover:text-white'}`}>
                      Subject {player.player_index}
                    </h3>
                    
                    <div className="w-full flex justify-center">
                      <Badge variant="outline" className={`font-mono text-[0.65rem] uppercase tracking-widest px-3 py-1 border transition-colors ${
                        player.confidence >= 0.8 ? 'border-teal-500/30 text-teal-300 bg-teal-500/10' : 
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

        <div className="gsap-button max-w-sm mx-auto">
          <Button
            className={`w-full h-16 rounded-[2rem] text-base font-bold transition-all duration-300 ${
              selectedIndex !== null 
                ? 'button-accent shadow-[0_0_25px_rgba(20,184,166,0.3)] hover:scale-105 hover:shadow-[0_0_35px_rgba(20,184,166,0.5)]' 
                : 'bg-zinc-900 border border-white/5 text-zinc-500 cursor-not-allowed shadow-none'
            }`}
            size="lg"
            disabled={selectedIndex === null}
            onClick={() => selectedIndex !== null && onSelect(selectedIndex)}
          >
            {selectedIndex !== null ? (
              <span className="flex items-center gap-2 text-black">
                Confirm Selection 
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
              </span>
            ) : 'Select a subject to continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}
