package com.pr.golf.golfapp.model;

import com.pr.golf.golfapp.enums.GolfEventType;

import jakarta.persistence.Column;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;
import lombok.experimental.SuperBuilder;

@MappedSuperclass
@NoArgsConstructor
@SuperBuilder(toBuilder = true)
@Getter
@EqualsAndHashCode
@ToString
public class Event {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

	@Column(name="name")
    private String name;

    public String venue;

    public GolfEventType type;

}
