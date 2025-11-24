package com.independent.cardcodex.core_database

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "cards",
    foreignKeys = [
        ForeignKey(
            entity = SpeciesEntity::class,
            parentColumns = ["id"],
            childColumns = ["speciesId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["speciesId"])]
)
data class CardEntity(
    @PrimaryKey val cardId: String, // e.g., "base1-4"
    val speciesId: Int?, // Links to SpeciesEntity, nullable for "Uncategorized"
    val name: String,
    val set: String,
    val imageUrl: String,
    val inventoryCount: Int = 0
)
