package com.independent.cardcodex.core_database

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.independent.cardcodex.data.Ability
import com.independent.cardcodex.data.Attack
import com.independent.cardcodex.data.Legalities
import com.independent.cardcodex.data.Weakness

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
    val supertype: String?,
    val subtypes: List<String> = emptyList(),
    val types: List<String> = emptyList(),
    // New fields for detailed card information
    val level: String?,
    val hp: String?,
    val evolvesFrom: String?,
    val evolvesTo: List<String>?,
    val rules: List<String>?,
    val abilities: List<Ability>?,
    val attacks: List<Attack>?,
    val weaknesses: List<Weakness>?,
    val retreatCost: List<String>?,
    val convertedRetreatCost: Int?,
    val number: String?,
    val artist: String?,
    val rarity: String?,
    val flavorText: String?,
    val nationalPokedexNumbers: List<Int>?,
    val legalities: Legalities?
)
