package com.independent.cardcodex.core_database

import androidx.room.Embedded
import androidx.room.Junction
import androidx.room.Relation

data class DeckWithCards(
    @Embedded val deck: DeckEntity,
    @Relation(
        parentColumn = "id",
        entityColumn = "cardId",
        associateBy = Junction(
            value = DeckCardCrossRef::class,
            parentColumn = "deckId",
            entityColumn = "cardId"
        )
    )
    val cards: List<CardEntity>
)
