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

export default function PlayerSelector({ players, onSelect }: PlayerSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const getConfidenceVariant = (confidence: number) => {
    if (confidence >= 0.8) return 'default' // green
    if (confidence >= 0.6) return 'secondary' // yellow
    return 'destructive' // red
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6 flex flex-col items-center">
      <div className="max-w-4xl w-full">
        <h1 className="text-3xl font-bold text-white mb-2">
          Who do you want to analyze?
        </h1>
        <p className="text-gray-400 mb-8">
          AI detected {players.length} players. Select one to continue.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 mb-8">
          {players.map((player) => (
            <Card
              key={player.player_index}
              className={`cursor-pointer transition-all ${
                selectedIndex === player.player_index
                  ? 'ring-2 ring-indigo-500'
                  : 'hover:border-gray-600'
              }`}
              onClick={() => setSelectedIndex(player.player_index)}
            >
              <CardContent className="p-4">
                <img
                  src={`data:image/png;base64,${player.crop_base64}`}
                  alt={`Player ${player.player_index}`}
                  className="w-full aspect-square object-cover rounded-lg mb-4"
                />
                <h3 className="text-lg font-semibold text-white mb-2">
                  Player {player.player_index}
                </h3>
                <Badge
                  variant={getConfidenceVariant(player.confidence)}
                  className="text-sm"
                >
                  AI: {(player.confidence * 100).toFixed(0)}% confident
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
          size="lg"
          disabled={selectedIndex === null}
          onClick={() => selectedIndex !== null && onSelect(selectedIndex)}
        >
          Analyze Selected Player
        </Button>
      </div>
    </div>
  )
}
